#!/usr/bin/env python3
"""stdlib ThreadingHTTPServer that serves the frontend statically and exposes
a small read-only JSON API over the local filesystem and system state. Never
executes shell commands supplied by the browser; only reads.
"""

import argparse
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fs_scanner
import sysinfo

FRONTEND_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend"))

CONFIG = {"root": "/", "depth": 2}


class Handler(BaseHTTPRequestHandler):
    server_version = "KDESYNC/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        if not os.path.isfile(path):
            self._send_json({"error": "not found", "path": path}, status=404)
            return
        ctype, _ = mimetypes.guess_type(path)
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        try:
            if path.startswith("/api/"):
                self._handle_api(path, query)
            else:
                self._handle_static(path)
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001 - surface as JSON error, never crash the server
            self._send_json({"error": str(exc)}, status=500)

    def _handle_api(self, path, query):
        if path == "/api/system":
            self._send_json(sysinfo.get_system())
        elif path == "/api/health":
            self._send_json(sysinfo.get_health())
        elif path == "/api/storage":
            self._send_json(sysinfo.get_storage())
        elif path == "/api/processes":
            limit = int(query.get("limit", [8])[0])
            self._send_json(sysinfo.get_processes(limit=limit))
        elif path == "/api/config":
            self._send_json(CONFIG)
        elif path == "/api/tree":
            root = query.get("path", [CONFIG["root"]])[0]
            depth = int(query.get("depth", [CONFIG["depth"]])[0])
            self._send_json(fs_scanner.build_galaxy(root=root, depth=depth))
        elif path == "/api/node":
            target = query.get("path", [None])[0]
            if not target:
                self._send_json({"error": "missing path parameter"}, status=400)
                return
            self._send_json(fs_scanner.get_node_info(target))
        elif path == "/api/children":
            target = query.get("path", [None])[0]
            depth = int(query.get("depth", [1])[0])
            if not target:
                self._send_json({"error": "missing path parameter"}, status=400)
                return
            self._send_json(fs_scanner.list_children(target, depth=depth))
        else:
            self._send_json({"error": "unknown endpoint", "path": path}, status=404)

    def _handle_static(self, path):
        if path == "/":
            path = "/index.html"
        full = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip("/")))
        if not full.startswith(FRONTEND_DIR):
            self._send_json({"error": "forbidden"}, status=403)
            return
        self._send_file(full)


def main():
    parser = argparse.ArgumentParser(description="NOBARA KDESYNC backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--root", default="/")
    parser.add_argument("--depth", type=int, default=2)
    args = parser.parse_args()

    CONFIG["root"] = args.root
    CONFIG["depth"] = args.depth

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"NOBARA KDESYNC serving on http://{args.host}:{args.port}/  (root={args.root}, depth={args.depth})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
