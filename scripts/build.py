"""Build the portable single-file game served directly by GitHub Pages."""
from argparse import ArgumentParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src"
OUTPUT = ROOT / "index.html"


def render():
    html = (SOURCE / "shell.html").read_text(encoding="utf-8")
    for marker, filename in (("ENGINE_SOURCE", "engine.js"), ("UI_SOURCE", "ui.js")):
        token = f"<!-- {marker} -->"
        if html.count(token) != 1:
            raise ValueError(f"Expected exactly one {token} in src/shell.html")
        javascript = (SOURCE / filename).read_text(encoding="utf-8")
        html = html.replace(token, "<script>\n" + javascript + "\n</script>")
    return html.encode("utf-8")


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check committed index.html matches src without writing")
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != expected:
            parser.exit(1, "index.html is out of date. Run npm run build and include index.html.\n")
        print(f"index.html matches src ({len(expected):,} bytes)")
    else:
        OUTPUT.write_bytes(expected)
        print(f"Built index.html ({len(expected):,} bytes)")


if __name__ == "__main__":
    main()
