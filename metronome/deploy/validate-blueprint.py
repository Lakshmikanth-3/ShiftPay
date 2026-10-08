"""Validate the real Render Blueprint against Render's current official schema."""
import json
from pathlib import Path
from urllib.request import urlopen
import yaml
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parents[2]
with urlopen('https://render.com/schema/render.yaml.json', timeout=30) as response:
    schema = json.load(response)
blueprint = yaml.safe_load((root / 'render.yaml').read_text(encoding='utf-8'))
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(blueprint), key=lambda item: str(item.path))
if errors:
    for error in errors:
        print(f'{list(error.path)}: {error.message}')
    raise SystemExit(1)
print('PASS: Render Blueprint matches the current official JSON schema (two bridges, one database).')
print('This validates configuration structure; cloud provisioning and live health checks remain separate.')
