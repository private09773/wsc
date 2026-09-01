'use strict';
/*
 * parser.js
 * A minimal, dependency-free XML/SGML parser, just enough to read
 * well-formed WML source files (comments, processing instructions,
 * DOCTYPE, self-closing tags, quoted attributes, text nodes).
 * Not a general-purpose XML parser — built specifically for WML.
 */

function parseXML(src) {
  let i = 0;
  const n = src.length;

  function peek(str) {
    return src.startsWith(str, i);
  }

  function skipProlog() {
    // <?xml ... ?>
    while (peek('<?')) {
      const end = src.indexOf('?>', i);
      i = end === -1 ? n : end + 2;
      skipWhitespace();
    }
    // <!DOCTYPE ... >
    while (peek('<!DOCTYPE')) {
      let depth = 0;
      while (i < n) {
        if (src[i] === '<') depth++;
        if (src[i] === '>') {
          depth--;
          i++;
          if (depth === 0) break;
          continue;
        }
        i++;
      }
      skipWhitespace();
    }
  }

  function skipWhitespace() {
    while (i < n && /\s/.test(src[i])) i++;
  }

  function parseComment() {
    const end = src.indexOf('-->', i);
    const endIdx = end === -1 ? n : end + 3;
    i = endIdx;
  }

  function parseName() {
    const start = i;
    while (i < n && /[^\s/>=]/.test(src[i])) i++;
    return src.slice(start, i);
  }

  function parseAttrs() {
    const attrs = {};
    while (true) {
      skipWhitespace();
      if (peek('/>') || peek('>')) break;
      const name = parseName();
      if (!name) break;
      skipWhitespace();
      let value = '';
      if (src[i] === '=') {
        i++;
        skipWhitespace();
        const quote = src[i];
        if (quote === '"' || quote === "'") {
          i++;
          const start = i;
          while (i < n && src[i] !== quote) i++;
          value = src.slice(start, i);
          i++; // skip closing quote
        } else {
          const start = i;
          while (i < n && /[^\s/>]/.test(src[i])) i++;
          value = src.slice(start, i);
        }
      } else {
        value = name; // boolean-style attribute (e.g. checked)
      }
      attrs[name] = value;
    }
    return attrs;
  }

  function parseElement() {
    i++; // consume '<'
    const tag = parseName();
    const attrs = parseAttrs();
    skipWhitespace();
    let selfClosing = false;
    if (peek('/>')) {
      selfClosing = true;
      i += 2;
    } else if (peek('>')) {
      i += 1;
    }
    const node = { type: 'element', tag, attrs, children: [] };
    if (selfClosing) return node;

    while (i < n) {
      if (peek('</')) {
        const closeStart = i + 2;
        const closeEnd = src.indexOf('>', closeStart);
        i = closeEnd + 1;
        break;
      }
      if (peek('<!--')) {
        i += 4;
        parseComment();
        continue;
      }
      if (peek('<')) {
        node.children.push(parseElement());
        continue;
      }
      const textStart = i;
      while (i < n && src[i] !== '<') i++;
      const text = src.slice(textStart, i);
      if (text.trim().length > 0 || node.children.length === 0) {
        node.children.push({ type: 'text', value: text });
      }
    }
    return node;
  }

  skipWhitespace();
  skipProlog();
  skipWhitespace();
  while (peek('<!--')) {
    i += 4;
    parseComment();
    skipWhitespace();
  }
  return parseElement();
}

module.exports = { parseXML };