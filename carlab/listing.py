"""Reads a car listing page (a dealer's or a marketplace's) for what the car is: year, make, model, trim, body style,
its color, and its photos. Listings usually describe the car for search engines (schema.org JSON-LD, Open Graph
tags); this reads those first and falls back to the page's title and images."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

COLORS = {
    # A plain color for each common name in a listing's color ("Harbor Blue Metallic" -> blue).
    "black": "#0e0f11", "white": "#eceef0", "silver": "#b5b9be", "gray": "#6b7077", "grey": "#6b7077",
    "charcoal": "#3a3d42", "graphite": "#45484d", "blue": "#1f3f73", "navy": "#1a2440", "red": "#a3121c",
    "maroon": "#5a1018", "burgundy": "#5a1422", "green": "#24503a", "yellow": "#e0b81f", "orange": "#d9621c",
    "brown": "#4f3626", "beige": "#c8b694", "tan": "#b49a72", "gold": "#b08d3f", "bronze": "#8a6a3c",
    "purple": "#4a2a66", "violet": "#4a2a66", "teal": "#1f6a6a", "champagne": "#cdbb98",
}
BODY_STYLES = {
    "sedan": "sedan", "saloon": "sedan", "coupe": "coupe", "convertible": "convertible", "cabriolet": "convertible",
    "wagon": "wagon", "estate": "wagon", "hatchback": "hatchback", "suv": "suv", "crossover": "suv",
    "sport utility": "suv", "truck": "truck", "pickup": "truck", "van": "van", "minivan": "van",
}
YEAR = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
TITLE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\s+([A-Z][\w-]+)\s+([\w-]+)(?:\s+([\w-]+))?")
# Makes whose names are two words; any other title is read as year, make, model.
TWO_WORD_MAKES = {"alfa romeo", "aston martin", "land rover", "rolls royce", "mercedes benz"}
SKIP_IMAGE = re.compile(r"logo|icon|sprite|badge|avatar|placeholder|\.svg(\?|$)|1x1|pixel", re.I)


class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.json_ld, self.meta, self.images, self.title = [], {}, [], ""
        self._in_ld = self._in_title = False
        self._buffer = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_ld, self._buffer = True, []
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content"):
                self.meta.setdefault(key, []).append(a["content"].strip())
        elif tag in ("img", "source"):
            for attr in ("data-src", "data-lazy-src", "src"):
                if a.get(attr) and not a[attr].startswith("data:"):
                    self.images.append(a[attr].strip())
                    break

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld:
            self._in_ld = False
            self.json_ld.append("".join(self._buffer))
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_ld:
            self._buffer.append(data)
        elif self._in_title:
            self.title += data


def _things(raw_blocks):
    """Every object in the page's JSON-LD, nested @graph and itemOffered included."""
    out = []

    def walk(value):
        if isinstance(value, list):
            for v in value:
                walk(v)
        elif isinstance(value, dict):
            out.append(value)
            for key in ("@graph", "itemOffered", "offers", "mainEntity"):
                if key in value:
                    walk(value[key])

    for raw in raw_blocks:
        try:
            walk(json.loads(raw.strip().rstrip(";")))
        except ValueError:
            continue
    return out


def _types(thing):
    t = thing.get("@type", [])
    return {str(x).lower() for x in (t if isinstance(t, list) else [t])}


def _name(value) -> str:
    if isinstance(value, dict):
        value = value.get("name", "")
    if isinstance(value, list):
        value = value[0] if value else ""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _images(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [value.get("contentUrl") or value.get("url") or ""]
    if isinstance(value, list):
        return [u for v in value for u in _images(v)]
    return []


def color_of(name: str) -> dict | None:
    """A listing's color name as {name, hex, finish}, or None when no color word is in it."""
    text = (name or "").strip()
    if not text:
        return None
    words = re.findall(r"[a-z]+", text.lower())
    hex_ = next((COLORS[w] for w in reversed(words) if w in COLORS), None)
    if hex_ is None:
        return None
    finish = "pearl" if {"pearl", "pearlescent", "tricoat"} & set(words) else "matte" if {"matte", "frozen", "satin"} & set(words) \
        else "metallic" if {"metallic", "metal", "mica"} & set(words) else "gloss"
    return {"name": text, "hex": hex_, "finish": finish}


def body_style_of(text: str) -> str | None:
    lowered = (text or "").lower()
    for word, style in sorted(BODY_STYLES.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{re.escape(word)}\b", lowered):
            return style
    return None


def read(html: str, url: str = "") -> dict:
    """What a listing page says about its car. Missing facts are empty strings / None / []."""
    page = _Page()
    page.feed(html or "")
    page.close()
    things = _things(page.json_ld)
    car = next((t for t in things if _types(t) & {"car", "vehicle", "motorizedvehicle"}), None)
    if car is None:
        car = next((t for t in things if "product" in _types(t) and (t.get("model") or t.get("vehicleModelDate"))), None)
    car = car or {}

    name = _name(car.get("name")) or _name(page.meta.get("og:title", [""])[0]) or page.title.strip()
    make = _name(car.get("brand") or car.get("manufacturer"))
    model = _name(car.get("model"))
    year_text = str(car.get("vehicleModelDate") or car.get("modelDate") or car.get("productionDate") or "")
    year_match = YEAR.search(year_text) or YEAR.search(name)
    year = year_match.group(1) if year_match else ""
    trim = _name(car.get("vehicleConfiguration") or car.get("trim"))
    if not (make and model):
        found = TITLE.search(name)
        if found:
            first, second, third = found.group(2), found.group(3), found.group(4)
            if f"{first} {second}".lower() in TWO_WORD_MAKES and third:
                first, second = f"{first} {second}", third
            year = year or found.group(1)
            make = make or first
            model = model or second
    color = color_of(_name(car.get("color")))
    if color is None:
        color = color_of(next((c for c in page.meta.get("og:description", []) + [name] if color_of(c)), ""))
    body = body_style_of(_name(car.get("bodyType"))) or body_style_of(name)

    images = _images(car.get("image")) + page.meta.get("og:image", []) + page.meta.get("twitter:image", [])
    if len(images) < 3:
        images += page.images
    seen, photos = set(), []
    for src in images:
        absolute = urljoin(url, src.strip()) if url else src.strip()
        if absolute and absolute not in seen and not SKIP_IMAGE.search(absolute) and absolute.startswith(("http://", "https://", "/")):
            seen.add(absolute)
            photos.append(absolute)
    return {
        "name": name[:160], "year": year, "make": make[:40], "model": model[:60], "trim": trim[:60],
        "color": color, "body_style": body, "photos": photos[:12], "url": url,
    }
