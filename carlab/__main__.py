"""Runs carlab on this computer: python -m carlab (then open http://127.0.0.1:8100/)."""

from __future__ import annotations

import argparse
from wsgiref.simple_server import WSGIRequestHandler, make_server

from .server import App


class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 - the stdlib's name
        # Method, path and status only: never a query string (a pasted link) or a body.
        request = (self.requestline or "").split(" ")
        path = request[1].split("?")[0] if len(request) > 1 else "-"
        print(f"{request[0] if request else '-'} {path} {args[1] if len(args) > 1 else '-'}", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="carlab", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on (default: this computer only)")
    parser.add_argument("--port", type=int, default=8100)
    args = parser.parse_args(argv)
    app = App()
    with make_server(args.host, args.port, app, handler_class=QuietHandler) as httpd:
        print(f"carlab is running at http://{args.host}:{args.port}/", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
