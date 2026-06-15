#!/usr/bin/env python3
"""Tiny static server for local preview of the membership deck.

    python3 serve.py            # serves this directory on :8799

Avoids `python3 -m http.server` because that calls os.getcwd() at import,
which is blocked in some sandboxes. Here the directory is resolved from this
file's own path, so no getcwd() call is made.
"""
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8799"))

Handler = partial(SimpleHTTPRequestHandler, directory=ROOT)
with ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving {ROOT} on http://127.0.0.1:{PORT}")
    httpd.serve_forever()
