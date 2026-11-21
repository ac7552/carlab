"""Reading another site: only public addresses, every hop checked, sizes and kinds capped."""

import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from carlab import fetcher


@pytest.mark.parametrize("url", ["http://localhost/", "http://127.0.0.1:8100/", "http://10.0.0.5/", "http://192.168.1.1/",
                                 "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://0.0.0.0/"])
def test_refuses_this_machine_private_networks_and_cloud_metadata(url):
    with pytest.raises(fetcher.Error) as error:
        fetcher.get_page(url)
    assert "private address" in str(error.value)


@pytest.mark.parametrize("url", ["ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "not a link", "", "http://:80/"])
def test_refuses_things_that_arent_web_links(url):
    with pytest.raises(fetcher.Error) as error:
        fetcher.get_page(url)
    assert "web link" in str(error.value)


def test_a_name_that_resolves_to_a_private_address_is_refused(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0))])
    with pytest.raises(fetcher.Error) as error:
        fetcher.get_page("https://dealer.example/cars/1")
    assert "private address" in str(error.value)


def test_an_ipv4_address_inside_ipv6_is_checked_as_itself():
    assert not fetcher.allowed("::ffff:127.0.0.1")
    assert not fetcher.allowed("::ffff:10.0.0.1")
    assert fetcher.allowed("93.184.216.34")


class _Site(BaseHTTPRequestHandler):
    """A pretend listing site on this machine. Paths say what to answer."""

    def do_GET(self):  # noqa: N802 - the stdlib's name
        if self.path == "/car":
            self._send(200, "text/html; charset=utf-8", b"<title>2022 Rowan Atlas</title>")
        elif self.path == "/photo":
            self._send(200, "image/jpeg", b"\xff\xd8 photo")
        elif self.path == "/big":
            self._send(200, "text/html", b"x" * (fetcher.MAX_BYTES + 10))
        elif self.path == "/pdf":
            self._send(200, "application/pdf", b"%PDF")
        elif self.path == "/blocked":
            self._send(403, "text/html", b"no")
        elif self.path == "/loop":
            self._send(302, "text/html", b"", location="/loop")
        elif self.path == "/inside":
            self._send(302, "text/html", b"", location="http://intranet.example/admin")
        else:
            self._send(404, "text/html", b"")

    def _send(self, code, kind, body, location=None):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        if location:
            self.send_header("Location", location)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def site(monkeypatch):
    """dealer.example is the test site on this machine (let through as public); intranet.example is private."""
    server = HTTPServer(("127.0.0.1", 0), _Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    names = {"dealer.example": "127.0.0.1", "intranet.example": "10.0.0.8"}
    real = socket.getaddrinfo

    def lookup(host, *args, **kwargs):
        if host in names:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (names[host], 0))]
        return real(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", lookup)
    monkeypatch.setattr(fetcher, "allowed", lambda address: address == "127.0.0.1")
    yield f"http://dealer.example:{server.server_port}"
    server.shutdown()


def test_reads_a_page_and_a_photo(site):
    assert "Rowan Atlas" in fetcher.get_page(f"{site}/car")
    assert fetcher.get_image(f"{site}/photo") == (b"\xff\xd8 photo", "image/jpeg")


def test_a_redirect_to_a_private_address_is_refused(site):
    with pytest.raises(fetcher.Error) as error:
        fetcher.get_page(f"{site}/inside")
    assert "private address" in str(error.value)


@pytest.mark.parametrize("path, message", [
    ("/big", "too big"), ("/pdf", "isn't a web page"), ("/blocked", "doesn't let apps"), ("/loop", "kept sending us elsewhere"),
    ("/missing", "answered 404"),
])
def test_what_it_wont_read(site, path, message):
    with pytest.raises(fetcher.Error) as error:
        fetcher.get_page(f"{site}{path}")
    assert message in str(error.value)


def test_a_page_isnt_a_photo(site):
    with pytest.raises(fetcher.Error) as error:
        fetcher.get_image(f"{site}/car")
    assert str(error.value) == "That isn't a photo."
