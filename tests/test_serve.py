"""Serves the fixture feed next to web/ and checks the page, its assets and
the feed. Uses port 8947 (the lane's port + 100), or CONSTELLATION_TEST_PORT."""
import json
import os
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from vendor.agentfeed.serve import make_handler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PORT = int(os.environ.get("CONSTELLATION_TEST_PORT", "8947"))


class ServeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(WEB, True))
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path):
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (PORT, path), timeout=10) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()

    def test_page(self):
        status, ctype, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        for ref in (b"strata-loader.js", b"strata-kit.js", b"constellation.js"):
            self.assertIn(ref, body)

    def test_assets(self):
        for name, ctype in (("constellation.js", "javascript"), ("constellation-engine.js", "javascript"),
                            ("constellation-engine.wasm", "application/wasm"), ("strata-kit.js", "javascript"),
                            ("strata-loader.js", "javascript")):
            status, got, body = self.get("/" + name)
            self.assertEqual(status, 200, name)
            self.assertIn(ctype, got, name)
            self.assertGreater(len(body), 1000, name)

    def test_engine_exports(self):
        _, _, body = self.get("/constellation-engine.js")
        for name in (b"cv_set_places", b"cv_set_stars", b"cv_set_planets", b"createConstellation"):
            self.assertIn(name, body)

    def test_feed(self):
        for path in ("/api/agents", "/api/agents?fixture=1"):
            status, ctype, body = self.get(path)
            self.assertEqual(status, 200)
            doc = json.loads(body)
            self.assertEqual(doc["version"], 1)
            self.assertTrue(doc["fixture"])
            states = {s["state"] for s in doc["sessions"]}
            self.assertTrue({"busy", "idle", "waiting", "offline"} <= states)
            leads = [s for s in doc["sessions"] if s["followers"]]
            self.assertGreaterEqual(len(leads), 2)
            for s in doc["sessions"]:
                self.assertIn(s["place"], {p["id"] for p in doc["places"]})

    def test_page_js_matches_feed_vocabulary(self):
        with open(os.path.join(WEB, "constellation.js"), encoding="utf-8") as f:
            js = f.read()
        for word in ("edit", "run", "read", "web", "delegate", "think", "other",
                     "busy", "idle", "waiting", "offline", "stalled"):
            self.assertIn(word, js)

    def test_no_escape_from_web(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/../README.md")


if __name__ == "__main__":
    unittest.main()
