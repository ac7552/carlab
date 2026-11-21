"""Saved builds: what's accepted, and the store."""

import pytest

from carlab.builds import BuildError, Store, clean

PICTURE = "data:image/jpeg;base64," + "A" * 100


def test_a_build_is_saved_listed_changed_and_deleted():
    store = Store(":memory:")
    first = store.create({"name": "Weekend", "build": {"paint": {"color": "#a3121c"}}, "thumbnail": PICTURE})
    assert first["id"] and first["name"] == "Weekend" and first["build"]["paint"]["color"] == "#a3121c"
    second = store.create({"build": {"name": "From the build"}})
    assert second["name"] == "From the build"
    listed = store.all()
    assert [b["id"] for b in listed] == [second["id"], first["id"]]
    assert "build" not in listed[0], "the list is light: names and pictures"

    changed = store.update(first["id"], {"name": "Track day", "build": {"paint": {"color": "#000000"}}})
    assert changed["name"] == "Track day" and changed["build"]["paint"]["color"] == "#000000"
    assert changed["thumbnail"] == PICTURE, "a change without a new picture keeps the old one"
    assert store.update(999, {"build": {}}) is None

    assert store.delete(first["id"]) is True
    assert store.delete(first["id"]) is False
    assert store.get(first["id"]) is None


def test_it_keeps_builds_in_a_file(tmp_path):
    path = tmp_path / "deep" / "carlab.sqlite3"
    Store(path).create({"name": "Kept", "build": {}})
    assert [b["name"] for b in Store(path).all()] == ["Kept"]


@pytest.mark.parametrize("payload, message", [
    (None, "JSON object"),
    ({}, "no build"),
    ({"build": "red"}, "no build"),
    ({"build": {"x": "y" * 210_000}}, "too big"),
    ({"build": {}, "thumbnail": "https://elsewhere.example/a.jpg"}, "data URL"),
    ({"build": {}, "thumbnail": "data:image/svg+xml;base64,AAAA"}, "data URL"),
    ({"build": {}, "thumbnail": "data:image/jpeg;base64," + "A" * 400_001}, "too big"),
])
def test_what_isnt_accepted(payload, message):
    with pytest.raises(BuildError) as error:
        clean(payload)
    assert message in str(error.value)


def test_a_name_is_trimmed_and_capped():
    assert clean({"name": "  " + "n" * 200, "build": {}})["name"] == "n" * 80
    assert clean({"name": "   ", "build": {}})["name"] == "Untitled build"
