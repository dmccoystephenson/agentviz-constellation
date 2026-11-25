"""Serves the fixture feed next to web/ and checks the page, its assets, the
feed and the vendored copies, and that tracked files stay clean (no HTML
parsing of feed strings, no swallowed errors, no machine paths).
Stdlib only, Python 3.8+: python3 -m unittest discover -s tests"""
import json
import os
import re
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("CONSTELLATION_UNIT_PORT", "9121"))
BASE = "http://127.0.0.1:%d" % PORT

PAGE_SCRIPTS = ("strata-loader.js", "strata-kit.js", "agentviz-feed.js", "agentviz-screen.js", "agentviz-hud.js",
                "agentviz-wire.js", "constellation-model.js", "constellation-frame.js", "page.js")
OWN_SCRIPTS = ("constellation-model.js", "constellation-frame.js", "page.js")


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def tracked_files():
    out = subprocess.run(["git", "ls-files"], cwd=REPO, stdout=subprocess.PIPE, universal_newlines=True).stdout
    return out.split()


class ServeFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(
            [sys.executable, "-m", "vendor.agentfeed", "serve", "--web", "web", "--port", str(PORT), "--fixture"],
            cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                socket.create_connection(("127.0.0.1", PORT), timeout=0.5).close()
                return
            except OSError:
                time.sleep(0.1)
        cls.proc.kill()
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)

    def test_page_loads_the_kit_in_order(self):
        status, ctype, body = get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        html = body.decode()
        positions = [html.index('src="%s"' % script) for script in PAGE_SCRIPTS]
        self.assertEqual(positions, sorted(positions), "scripts out of order")
        self.assertIn("agentviz-hud.css", html)

    def test_assets(self):
        for asset in PAGE_SCRIPTS + ("agentviz-hud.css", "constellation-engine.js"):
            with self.subTest(asset=asset):
                status, _, body = get("/" + asset)
                self.assertEqual(status, 200)
                self.assertGreater(len(body), 500)
        status, ctype, body = get("/constellation-engine.wasm")
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "application/wasm")
        self.assertEqual(body[:4], b"\0asm")

    def test_engine_exports_only_the_wire_setter(self):
        self.assertIn("createConstellation", get("/page.js")[2].decode())
        engine = get("/constellation-engine.js")[2].decode()
        self.assertIn("_agentviz_frame", engine)
        self.assertNotIn("_cv_set_", engine)

    def test_page_never_parses_feed_strings_as_html_or_swallows_errors(self):
        for script in OWN_SCRIPTS:
            source = get("/" + script)[2].decode()
            self.assertNotIn("innerHTML", source, script)
            self.assertIsNone(re.search(r"catch\s*(\([^)]*\))?\s*\{\s*(/\*.*?\*/)?\s*\}", source, re.S),
                              script + ": empty catch")

    def test_feed_parses(self):
        status, _, body = get("/api/agents")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertEqual(doc["version"], 1)
        self.assertTrue(doc["fixture"])
        self.assertEqual({s["waitingReason"] for s in doc["sessions"] if s["state"] == "waiting"},
                         {"question", "permission"})
        for s in doc["sessions"]:
            self.assertIn(s["state"], ("offline", "dim", "idle", "busy", "waiting"))
            self.assertIn(s["action"], ("edit", "run", "read", "web", "delegate", "think", "other", "none"))
            self.assertIn(s["place"], {p["id"] for p in doc["places"]})
            for f in s["followers"]:
                self.assertIn(f["state"], ("active", "resting"))
        followers = [f for s in doc["sessions"] for f in s["followers"]]
        self.assertTrue(any(f.get("stalled") for f in followers))
        self.assertTrue(any(f.get("finished") for f in followers))
        self.assertTrue(all("toolCount" in p for p in doc["places"]))

    def test_no_escape_from_web(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            get("/../vendor/agentfeed/feed.py")
        self.assertEqual(e.exception.code, 404)


class VendoredCopiesTest(unittest.TestCase):
    def test_vendored_copies_match_their_pins(self):
        result = subprocess.run([sys.executable, os.path.join(REPO, "vendor", "agentviz-kit", "check_vendor.py"), REPO],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class NoLocalPathsTest(unittest.TestCase):
    MACHINE_ROOT = "/" + "root/"  # split so this file does not match itself

    def test_no_machine_paths_in_tracked_text(self):
        skip = (".wasm", ".png", ".gif", "package-lock.json")
        for name in tracked_files():
            if name.endswith(skip) or name.startswith("vendor/") or not os.path.isfile(os.path.join(REPO, name)):
                continue
            with open(os.path.join(REPO, name), encoding="utf-8", errors="replace") as fh:
                self.assertNotIn(self.MACHINE_ROOT, fh.read(), name)


if __name__ == "__main__":
    unittest.main()
