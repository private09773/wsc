#!/usr/bin/env node
'use strict';
/*
 * wmlc.js — the WML compiler
 * Usage: node wmlc.js <entry.wml> [outDir]
 *
 * Reads a WML Alpha 2 "X-ray" source file (e.g. home.wml), resolves
 * IMPORT / COMPONENT / STATE / THEME / ROUTE, and emits:
 *   <outDir>/index.html
 *   <outDir>/wml-runtime.js
 */

const fs = require('fs');
const path = require('path');
const { parseXML } = require('./parser');

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'break', 'line', 'checkbox']);

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function collect(node, tag, out) {
  if (!node) return out;
  if (node.type === 'element' && node.tag.toLowerCase() === tag.toLowerCase()) out.push(node);
  (node.children || []).forEach((c) => collect(c, tag, out));
  return out;
}

function findAll(node, predicate, out) {
  out = out || [];
  if (!node) return out;
  if (node.type === 'element' && predicate(node)) out.push(node);
  (node.children || []).forEach((c) => findAll(c, predicate, out));
  return out;
}

class Compiler {
  constructor(entryPath) {
    this.entryPath = entryPath;
    this.baseDir = path.dirname(entryPath);
    this.components = new Map(); // name -> element node
    this.stateDecls = {};        // name -> {type, value}
    this.themeTokens = [];       // [{name, value}]
    this.routes = [];            // [{path, src}]
    this.idCounter = 0;
  }

  nextId(prefix) {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  // ---- Phase 1: resolve IMPORTs, register COMPONENTs, STATE, THEME, ROUTE ----
  resolveImports(node, baseDir) {
    findAll(node, (n) => n.tag.toUpperCase() === 'IMPORT').forEach((imp) => {
      const src = imp.attrs.src;
      const fullPath = path.resolve(baseDir, src);
      const importedSrc = readFile(fullPath);
      const importedTree = parseXML(importedSrc);
      this.registerComponents(importedTree);
      // imported files may themselves import others
      this.resolveImports(importedTree, path.dirname(fullPath));
    });
  }

  registerComponents(node) {
    collect(node, 'COMPONENT', []).forEach((c) => {
      this.components.set(c.attrs.name, c);
    });
  }

  collectStateThemeRoutes(node) {
    collect(node, 'STATE', []).forEach((s) => {
      this.stateDecls[s.attrs.name] = {
        type: s.attrs.type || 'string',
        value: s.attrs.value !== undefined ? s.attrs.value : ''
      };
    });
    collect(node, 'TOKEN', []).forEach((t) => {
      this.themeTokens.push({ name: t.attrs.name, value: t.attrs.value });
    });
    collect(node, 'ROUTE', []).forEach((r) => {
      this.routes.push({ path: r.attrs.path, src: r.attrs.src });
    });
  }

  coerceInitial(decl) {
    if (decl.type === 'number') return Number(decl.value || 0);
    if (decl.type === 'boolean') return decl.value === 'true' || decl.value === true;
    if (decl.type === 'list') return String(decl.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    return decl.value;
  }

  // ---- Phase 2: render BODY to HTML ----
  renderChildren(nodes, slotContent) {
    return nodes.map((n) => this.renderNode(n, slotContent)).join('');
  }

  attrString(attrs, skip) {
    skip = skip || [];
    return Object.keys(attrs)
      .filter((k) => !skip.includes(k) && !k.startsWith('wml-'))
      .map((k) => ` ${k}="${attrs[k]}"`)
      .join('');
  }

  renderNode(node, slotContent) {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return '';

    const tag = node.tag;
    const upper = tag.toUpperCase();
    const lower = tag.toLowerCase();
    const attrs = node.attrs || {};

    // --- directive-only elements: never render themselves ---
    if (['STATE', 'THEME', 'TOKEN', 'ROUTE', 'IMPORT', 'COMPONENT'].includes(upper)) {
      return '';
    }

    if (lower === 'stylesheet') {
      // Alpha 0.5: <stylesheet> compiles down to a real <style> tag.
      const rawCSS = (node.children || []).map((c) => c.value || '').join('');
      return `<style${this.attrString(attrs)}>${rawCSS}</style>`;
    }

    if (lower === 'javascript') {
      // Alpha 0.5: <javascript> compiles down to a real <script> tag.
      const rawJS = (node.children || []).map((c) => c.value || '').join('');
      return `<script${this.attrString(attrs)}>${rawJS}</script>`;
    }

    if (upper === 'BIND') {
      // handled by the parent element via collectBindDirectives; render nothing here
      return '';
    }

    if (upper === 'USE') {
      const comp = this.components.get(attrs.component);
      if (!comp) return `<!-- WML: unknown component "${attrs.component}" -->`;
      const passedSlot = this.renderChildren(node.children || []);
      return this.renderChildren(comp.children || [], passedSlot || slotContent);
    }

    if (upper === 'SLOT') {
      if (slotContent !== undefined && slotContent !== '') return slotContent;
      return this.renderChildren(node.children || []);
    }

    if (upper === 'IF') {
      const id = this.nextId('if');
      const inner = this.renderChildren(node.children || [], slotContent);
      return `<div data-wml-if="${attrs.condition}">${inner}</div>`;
    }

    if (upper === 'ELSE') {
      // ELSE mirrors the condition of the immediately preceding IF at render time;
      // we approximate by requiring authors to place ELSE right after IF and reusing
      // the sibling condition captured during a pre-pass (see wireElse below).
      const inner = this.renderChildren(node.children || [], slotContent);
      return `<div data-wml-if="${node._elseCondition || ''}" data-wml-else>${inner}</div>`;
    }

    if (upper === 'REPEAT') {
      const templateHTML = this.renderChildren(node.children || [], slotContent);
      return `<template data-wml-repeat="${attrs.source}" data-wml-as="${attrs.as}">${this.toTemplatePlaceholder(node, attrs.as)}</template>`;
    }

    if (lower === 'line') {
      const weight = attrs.weight || 'medium';
      return `<hr class="wml-line wml-line--${weight}"${this.attrString(attrs, ['weight'])}/>`;
    }

    if (lower === 'break') {
      return `<br${this.attrString(attrs)}/>`;
    }

    if (lower === 'checkbox') {
      const bind = attrs['wml-bind'] ? ` data-wml-bind="${attrs['wml-bind']}"` : '';
      const checkedAttr = attrs.checked ? ' checked' : '';
      return `<input type="checkbox"${this.attrString(attrs, ['checked'])}${checkedAttr}${bind}/>`;
    }

    // --- regular pass-through element (HTML 4.01-derived) ---
    const binds = [];
    (node.children || []).forEach((c) => {
      if (c.type === 'element' && c.tag.toUpperCase() === 'BIND') {
        binds.push({
          event: c.attrs.event,
          state: c.attrs.state,
          action: c.attrs.action,
          value: c.attrs.value
        });
      }
    });

    const wmlBind = attrs['wml-bind'] ? ` data-wml-bind="${attrs['wml-bind']}"` : '';
    const bindEvents = binds.length ? ` data-wml-bind-events='${JSON.stringify(binds)}'` : '';
    const inner = this.renderChildren(
      (node.children || []).filter((c) => !(c.type === 'element' && c.tag.toUpperCase() === 'BIND')),
      slotContent
    );

    const openAttrs = this.attrString(attrs) + wmlBind + bindEvents;
    if (VOID_TAGS.has(lower)) {
      return `<${lower}${openAttrs}/>`;
    }
    return `<${lower}${openAttrs}>${inner}</${lower}>`;
  }

  // used only for the visual "preview" render inside <template>, kept simple:
  // just re-render children with {{as}} left as literal text for the bound span.
  toTemplatePlaceholder(node, asVar) {
    return this.renderChildren(node.children || []).split(`data-wml-bind="${asVar}"></span>`)
      .join(`data-wml-bind="${asVar}">{{${asVar}}}</span>`);
  }

  wireElseConditions(node) {
    // Walk BODY's direct children stream and attach the preceding IF's condition to ELSE
    const walk = (n) => {
      if (!n.children) return;
      let lastCondition = null;
      n.children.forEach((c) => {
        if (c.type === 'element' && c.tag.toUpperCase() === 'IF') {
          lastCondition = c.attrs.condition;
        } else if (c.type === 'element' && c.tag.toUpperCase() === 'ELSE') {
          c._elseCondition = lastCondition;
          lastCondition = null;
        }
        if (c.type === 'element') walk(c);
      });
    };
    walk(node);
  }

  compile() {
    const src = readFile(this.entryPath);
    const tree = parseXML(src);

    this.resolveImports(tree, this.baseDir);
    this.registerComponents(tree);
    this.collectStateThemeRoutes(tree);
    this.wireElseConditions(tree);

    const headEl = collect(tree, 'HEAD', [])[0];
    const bodyEl = collect(tree, 'BODY', [])[0];

    const title = headEl ? (collect(headEl, 'TITLE', [])[0] || {}) : {};
    const titleText = title.children ? title.children.map((c) => c.value || '').join('') : 'WML Site';

    // Author-provided head.misc elements that pass straight through: meta, link,
    // stylesheet (-> style), javascript (-> script). title/theme/imp/comp/state
    // are handled separately and skipped here.
    const passthroughHeadTags = ['META', 'LINK', 'STYLESHEET', 'JAVASCRIPT'];
    const headExtrasHTML = headEl
      ? (headEl.children || [])
          .filter((c) => c.type === 'element' && passthroughHeadTags.includes(c.tag.toUpperCase()))
          .map((c) => this.renderNode(c))
          .join('\n  ')
      : '';

    const bodyHTML = bodyEl ? this.renderChildren(bodyEl.children || []) : '';

    const initialState = {};
    Object.keys(this.stateDecls).forEach((name) => {
      initialState[name] = this.coerceInitial(this.stateDecls[name]);
    });

    const themeCSS = this.themeTokens.map((t) => `  --${t.name}: ${t.value};`).join('\n');

    const routesJSON = JSON.stringify(this.routes);

    const html = `<!DOCTYPE html>
<!-- Compiled by wmlc from ${path.basename(this.entryPath)} — WML ${tree.attrs.version || ''} "${tree.attrs.codename || ''}" -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="generator" content="wmlc (WML compiler)"/>
  <title>${titleText}</title>
  ${headExtrasHTML}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
${themeCSS}
    }
    body { font-family: var(--font-base, Inter, sans-serif); }
    .wml-line { border: none; }
    .wml-line--thin { border-top: 1px solid #ccc; }
    .wml-line--medium { border-top: 2px solid #999; }
    .wml-line--thick { border-top: 4px solid #666; }
  </style>
  <script type="application/json" id="wml-state">${JSON.stringify(initialState)}</script>
  <script type="application/json" id="wml-routes">${routesJSON}</script>
</head>
<body>
${bodyHTML}
<script src="wml-runtime.js"></script>
</body>
</html>
`;

    return { html };
  }
}

function main() {
  const entry = process.argv[2];
  const outDir = process.argv[3] || path.join(path.dirname(entry), 'dist');
  if (!entry) {
    console.error('Usage: node wmlc.js <entry.wml> [outDir]');
    process.exit(1);
  }
  const compiler = new Compiler(path.resolve(entry));
  const { html } = compiler.compile();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  fs.copyFileSync(path.join(__dirname, 'wml-runtime.js'), path.join(outDir, 'wml-runtime.js'));

  console.log(`WML compiled -> ${path.join(outDir, 'index.html')}`);
}

main();