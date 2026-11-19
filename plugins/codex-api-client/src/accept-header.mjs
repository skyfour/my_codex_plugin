// RFC 9110 §§ 5.6, 12.4.2, and 12.5.1.
const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const quoted = /"(?:[\t\x20-\x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t\x20-\x7e\x80-\xff])*"/;
const mediaRange = new RegExp('(' + token + ')/(' + token + ')', 'y');
const parameter = new RegExp('(' + token + ')=(' + token + '|' + quoted.source + ')', 'y');
const whitespace = /[ \t]*/y;
const quality = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;

export function isValidAccept(value) {
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(value)) return false;
  // A variable may resolve to an entire media range or list at send time.
  if (/\{\{[^{}]+\}\}/.test(value)) return true;
  let index = 0;
  function skipWhitespace() {
    whitespace.lastIndex = index;
    whitespace.test(value);
    index = whitespace.lastIndex;
  }

  skipWhitespace();
  while (index < value.length) {
    // Empty list entries are permitted for recipients, including an empty field.
    if (value[index] === ',') {
      index++;
      skipWhitespace();
      continue;
    }

    mediaRange.lastIndex = index;
    const match = mediaRange.exec(value);
    if (!match || (match[1] === '*' && match[2] !== '*')) return false;
    index = mediaRange.lastIndex;
    skipWhitespace();

    let hasQuality = false;
    while (value[index] === ';') {
      index++;
      skipWhitespace();
      if (index === value.length || value[index] === ';' || value[index] === ',') continue;

      parameter.lastIndex = index;
      const entry = parameter.exec(value);
      if (!entry) return false;
      if (entry[1].toLowerCase() === 'q') {
        if (hasQuality || !quality.test(entry[2])) return false;
        hasQuality = true;
      }
      index = parameter.lastIndex;
      skipWhitespace();
    }
    if (index < value.length && value[index] !== ',') return false;
  }
  return true;
}
