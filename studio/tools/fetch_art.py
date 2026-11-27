#!/usr/bin/env python3
"""Fetch selected public-domain works from the Art Institute of Chicago."""

import argparse
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen


WORKS = {
    'tuscany': 28,
    'trysts': 81509,
    'marsh': 880,
    'wheat': 14624,
    'deauville': 59823,
    'sainte-adresse': 14598,
    'southampton': 56905,
    'marseille': 16487,
    'imagiri': 4374,
    'mist': 10926,
    'poppies': 94240,
    'flower-clouds': 76395,
}


def get(url):
    request = Request(url, headers={'User-Agent': 'CubyStudio-ArtAssets/1.0'})
    with urlopen(request, timeout=20) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path(__file__).resolve().parents[1] / '.cache/raw')
    cache = parser.parse_args().cache / 'art'
    cache.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for slug, work_id in WORKS.items():
        fields = 'id,title,artist_title,is_public_domain,image_id'
        endpoint = f'https://api.artic.edu/api/v1/artworks/{work_id}?fields={fields}'
        result = json.loads(get(endpoint))
        work = result['data']
        if work['is_public_domain'] is not True or not work['image_id']:
            raise ValueError(f'{work_id} has no public-domain image')
        image_url = f"{result['config']['iiif_url']}/{work['image_id']}/full/843,/0/default.jpg"
        image = cache / f'{slug}.jpg'
        if not image.exists():
            image.write_bytes(get(image_url))
            time.sleep(1)
        manifest[slug] = {
            'title': work['title'],
            'artist': work['artist_title'],
            'source': f'https://www.artic.edu/artworks/{work_id}',
            'license': 'CC0 1.0',
        }
        print(slug, work['title'])
    (cache / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
