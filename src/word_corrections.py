"""Local, explicit spelling replacements for newly transcribed speech."""
import re
import json


def validate_rules(value):
    if not isinstance(value, list) or len(value) > 200:
        raise ValueError('Use at most 200 word corrections.')
    rules = []
    seen = set()
    for row in value:
        if not isinstance(row, dict):
            raise ValueError('Each correction needs an original and replacement.')
        pair = []
        for key in ('original', 'replacement'):
            text = row.get(key)
            if not isinstance(text, str) or not text.strip() or len(text) > 120:
                raise ValueError('Each name must contain 1 to 120 characters.')
            if any(ord(char) < 32 or char in '[]\u0085\u2028\u2029' for char in text) or text.strip().startswith(('#', '---')):
                raise ValueError('Names cannot contain line breaks or square brackets.')
            pair.append(text.strip())
        original, replacement = pair
        if original.casefold() in seen:
            raise ValueError('Each original name can appear only once.')
        seen.add(original.casefold())
        rules.append(dict(original=original, replacement=replacement))
    if len(json.dumps(rules, ensure_ascii=False).encode("utf-8")) > 16000:
        raise ValueError("The word correction list is too large (maximum 16 KB).")
    return rules


def correct_transcript(text, rules, *, diarised=False):
    if not text or not rules or text.strip() == "No speech detected in audio":
        return text
    # One pass avoids cascading replacements and preserves literal punctuation.
    choices = sorted(rules, key=lambda row: len(row['original']), reverse=True)
    pattern = re.compile('|'.join(
        '(?<!\\w)(' + re.escape(row['original']) + ')(?!\\w)' for row in choices
    ), re.IGNORECASE)

    def replace(body):
        return pattern.sub(lambda match: choices[match.lastindex - 1]['replacement'], body)

    if not diarised:
        return replace(text)
    lines = []
    for line in text.splitlines(keepends=True):
        # Keep speaker labels and timestamps, which identify speaker evidence.
        marker = re.match(r'^(?:\[\d+(?::\d{2}){1,2}(?:\.\d+)?\]\s*)?\[[^\]\r\n]+\][ \t]*', line)
        if marker:
            line = marker[0] + replace(line[marker.end():])
        elif not line.startswith('--- '):
            line = replace(line)
        lines.append(line)
    return ''.join(lines)
