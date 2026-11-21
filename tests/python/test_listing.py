"""Reading a car listing page: what the car is, its color, and its photos."""

import json
from pathlib import Path

from carlab import listing

SAMPLES = Path(__file__).resolve().parents[2] / "carlab" / "static" / "samples"


def page(head="", body=""):
    return f"<!doctype html><html><head>{head}</head><body>{body}</body></html>"


def ld(data):
    return f'<script type="application/ld+json">{json.dumps(data)}</script>'


def test_reads_a_car_from_its_json_ld():
    html = page(ld({
        "@context": "https://schema.org", "@type": "Car", "name": "2021 Rowan Atlas LX",
        "brand": {"@type": "Brand", "name": "Rowan"}, "model": "Atlas", "vehicleModelDate": "2021",
        "vehicleConfiguration": "LX", "color": "Harbor Blue Metallic", "bodyType": "Sedan",
        "image": ["https://cdn.dealer.example/1.jpg", {"@type": "ImageObject", "contentUrl": "https://cdn.dealer.example/2.jpg"}],
    }))
    car = listing.read(html, "https://dealer.example/cars/123")
    assert (car["year"], car["make"], car["model"], car["trim"]) == ("2021", "Rowan", "Atlas", "LX")
    assert car["color"] == {"name": "Harbor Blue Metallic", "hex": "#1f3f73", "finish": "metallic"}
    assert car["body_style"] == "sedan"
    assert car["photos"] == ["https://cdn.dealer.example/1.jpg", "https://cdn.dealer.example/2.jpg"]


def test_finds_the_car_inside_a_graph_or_an_offer():
    graph = page(ld({"@graph": [{"@type": "WebPage", "name": "Listing"}, {"@type": ["Vehicle"], "name": "Kite", "brand": "Merrow", "model": "Kite"}]}))
    assert listing.read(graph)["make"] == "Merrow"
    offer = page(ld({"@type": "Offer", "price": 1, "itemOffered": {"@type": "Car", "brand": "Tollan", "model": "Ridge", "modelDate": "2019"}}))
    found = listing.read(offer)
    assert (found["make"], found["model"], found["year"]) == ("Tollan", "Ridge", "2019")


def test_falls_back_to_the_pages_title_and_images():
    html = page(
        '<meta property="og:title" content="2018 Calder Breeze Wagon for sale">'
        '<meta property="og:image" content="/photos/main.jpg">',
        '<img src="/img/logo.png"><img src="/photos/side.jpg"><img src="data:image/gif;base64,R0lGOD">'
        '<img data-src="/photos/front.jpg" src="/img/placeholder.gif">',
    )
    car = listing.read(html, "https://used.example/listing/9")
    assert (car["year"], car["make"], car["model"]) == ("2018", "Calder", "Breeze")
    assert car["body_style"] == "wagon"
    assert car["photos"] == ["https://used.example/photos/main.jpg", "https://used.example/photos/side.jpg", "https://used.example/photos/front.jpg"]


def test_broken_json_ld_is_skipped_not_fatal():
    html = page('<script type="application/ld+json">{not json</script><title>2020 Pell Orbit</title>')
    car = listing.read(html)
    assert (car["year"], car["make"], car["model"]) == ("2020", "Pell", "Orbit")
    assert car["color"] is None and car["photos"] == []


def test_an_empty_or_odd_page_gives_empty_facts():
    for html in ["", "<html>", "just words"]:
        car = listing.read(html)
        assert car["make"] == "" and car["photos"] == [] and car["color"] is None


def test_color_names():
    assert listing.color_of("Midnight Black Pearl") == {"name": "Midnight Black Pearl", "hex": "#0e0f11", "finish": "pearl"}
    assert listing.color_of("Frozen Gray")["finish"] == "matte"
    assert listing.color_of("Red")["finish"] == "gloss"
    assert listing.color_of("Sunset Over Dunes") is None
    assert listing.color_of("") is None


def test_a_title_with_a_two_word_make():
    car = listing.read("<title>2017 Land Rover Defender 110 for sale</title>")
    assert (car["make"], car["model"]) == ("Land Rover", "Defender")


def test_body_styles():
    assert listing.body_style_of("Sport Utility Vehicle") == "suv"
    assert listing.body_style_of("4dr Hatchback") == "hatchback"
    assert listing.body_style_of("Crew Cab Pickup") == "truck"
    assert listing.body_style_of("") is None


def test_no_more_than_a_dozen_photos():
    html = page(ld({"@type": "Car", "brand": "A", "model": "B", "image": [f"https://x.example/{i}.jpg" for i in range(30)]}))
    assert len(listing.read(html)["photos"]) == 12


def test_the_sample_listings_read_as_their_cars():
    names = sorted(p.stem for p in SAMPLES.glob("*.html"))
    assert len(names) >= 3
    for name in names:
        car = listing.read((SAMPLES / f"{name}.html").read_text(), f"/static/samples/{name}.html")
        assert car["make"] and car["model"] and car["year"], name
        assert car["color"] and car["body_style"], name
        assert car["photos"] and all(p.startswith(f"/static/samples/{name}-") for p in car["photos"]), name
        for photo in car["photos"]:
            assert (SAMPLES / photo.rsplit("/", 1)[1]).is_file(), photo
