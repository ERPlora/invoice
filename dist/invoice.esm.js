var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i8 = decorators.length - 1, decorator; i8 >= 0; i8--)
    if (decorator = decorators[i8])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// ../modules-workspace/node_modules/.pnpm/@lit+reactive-element@2.1.2/node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t5, e6, o7) {
    if (this._$cssResult$ = true, o7 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t5, this.t = e6;
  }
  get styleSheet() {
    let t5 = this.o;
    const s5 = this.t;
    if (e && void 0 === t5) {
      const e6 = void 0 !== s5 && 1 === s5.length;
      e6 && (t5 = o.get(s5)), void 0 === t5 && ((this.o = t5 = new CSSStyleSheet()).replaceSync(this.cssText), e6 && o.set(s5, t5));
    }
    return t5;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t5) => new n("string" == typeof t5 ? t5 : t5 + "", void 0, s);
var i = (t5, ...e6) => {
  const o7 = 1 === t5.length ? t5[0] : e6.reduce((e7, s5, o8) => e7 + ((t6) => {
    if (true === t6._$cssResult$) return t6.cssText;
    if ("number" == typeof t6) return t6;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t6 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s5) + t5[o8 + 1], t5[0]);
  return new n(o7, t5, s);
};
var S = (s5, o7) => {
  if (e) s5.adoptedStyleSheets = o7.map((t5) => t5 instanceof CSSStyleSheet ? t5 : t5.styleSheet);
  else for (const e6 of o7) {
    const o8 = document.createElement("style"), n6 = t.litNonce;
    void 0 !== n6 && o8.setAttribute("nonce", n6), o8.textContent = e6.cssText, s5.appendChild(o8);
  }
};
var c = e ? (t5) => t5 : (t5) => t5 instanceof CSSStyleSheet ? ((t6) => {
  let e6 = "";
  for (const s5 of t6.cssRules) e6 += s5.cssText;
  return r(e6);
})(t5) : t5;

// ../modules-workspace/node_modules/.pnpm/@lit+reactive-element@2.1.2/node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t5, s5) => t5;
var u = { toAttribute(t5, s5) {
  switch (s5) {
    case Boolean:
      t5 = t5 ? l : null;
      break;
    case Object:
    case Array:
      t5 = null == t5 ? t5 : JSON.stringify(t5);
  }
  return t5;
}, fromAttribute(t5, s5) {
  let i8 = t5;
  switch (s5) {
    case Boolean:
      i8 = null !== t5;
      break;
    case Number:
      i8 = null === t5 ? null : Number(t5);
      break;
    case Object:
    case Array:
      try {
        i8 = JSON.parse(t5);
      } catch (t6) {
        i8 = null;
      }
  }
  return i8;
} };
var f = (t5, s5) => !i2(t5, s5);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t5) {
    this._$Ei(), (this.l ??= []).push(t5);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t5, s5 = b) {
    if (s5.state && (s5.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t5) && ((s5 = Object.create(s5)).wrapped = true), this.elementProperties.set(t5, s5), !s5.noAccessor) {
      const i8 = Symbol(), h4 = this.getPropertyDescriptor(t5, i8, s5);
      void 0 !== h4 && e2(this.prototype, t5, h4);
    }
  }
  static getPropertyDescriptor(t5, s5, i8) {
    const { get: e6, set: r6 } = h(this.prototype, t5) ?? { get() {
      return this[s5];
    }, set(t6) {
      this[s5] = t6;
    } };
    return { get: e6, set(s6) {
      const h4 = e6?.call(this);
      r6?.call(this, s6), this.requestUpdate(t5, h4, i8);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t5) {
    return this.elementProperties.get(t5) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t5 = n2(this);
    t5.finalize(), void 0 !== t5.l && (this.l = [...t5.l]), this.elementProperties = new Map(t5.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t6 = this.properties, s5 = [...r2(t6), ...o2(t6)];
      for (const i8 of s5) this.createProperty(i8, t6[i8]);
    }
    const t5 = this[Symbol.metadata];
    if (null !== t5) {
      const s5 = litPropertyMetadata.get(t5);
      if (void 0 !== s5) for (const [t6, i8] of s5) this.elementProperties.set(t6, i8);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t6, s5] of this.elementProperties) {
      const i8 = this._$Eu(t6, s5);
      void 0 !== i8 && this._$Eh.set(i8, t6);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s5) {
    const i8 = [];
    if (Array.isArray(s5)) {
      const e6 = new Set(s5.flat(1 / 0).reverse());
      for (const s6 of e6) i8.unshift(c(s6));
    } else void 0 !== s5 && i8.push(c(s5));
    return i8;
  }
  static _$Eu(t5, s5) {
    const i8 = s5.attribute;
    return false === i8 ? void 0 : "string" == typeof i8 ? i8 : "string" == typeof t5 ? t5.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t5) => this.enableUpdating = t5), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t5) => t5(this));
  }
  addController(t5) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t5), void 0 !== this.renderRoot && this.isConnected && t5.hostConnected?.();
  }
  removeController(t5) {
    this._$EO?.delete(t5);
  }
  _$E_() {
    const t5 = /* @__PURE__ */ new Map(), s5 = this.constructor.elementProperties;
    for (const i8 of s5.keys()) this.hasOwnProperty(i8) && (t5.set(i8, this[i8]), delete this[i8]);
    t5.size > 0 && (this._$Ep = t5);
  }
  createRenderRoot() {
    const t5 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t5, this.constructor.elementStyles), t5;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t5) => t5.hostConnected?.());
  }
  enableUpdating(t5) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t5) => t5.hostDisconnected?.());
  }
  attributeChangedCallback(t5, s5, i8) {
    this._$AK(t5, i8);
  }
  _$ET(t5, s5) {
    const i8 = this.constructor.elementProperties.get(t5), e6 = this.constructor._$Eu(t5, i8);
    if (void 0 !== e6 && true === i8.reflect) {
      const h4 = (void 0 !== i8.converter?.toAttribute ? i8.converter : u).toAttribute(s5, i8.type);
      this._$Em = t5, null == h4 ? this.removeAttribute(e6) : this.setAttribute(e6, h4), this._$Em = null;
    }
  }
  _$AK(t5, s5) {
    const i8 = this.constructor, e6 = i8._$Eh.get(t5);
    if (void 0 !== e6 && this._$Em !== e6) {
      const t6 = i8.getPropertyOptions(e6), h4 = "function" == typeof t6.converter ? { fromAttribute: t6.converter } : void 0 !== t6.converter?.fromAttribute ? t6.converter : u;
      this._$Em = e6;
      const r6 = h4.fromAttribute(s5, t6.type);
      this[e6] = r6 ?? this._$Ej?.get(e6) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t5, s5, i8, e6 = false, h4) {
    if (void 0 !== t5) {
      const r6 = this.constructor;
      if (false === e6 && (h4 = this[t5]), i8 ??= r6.getPropertyOptions(t5), !((i8.hasChanged ?? f)(h4, s5) || i8.useDefault && i8.reflect && h4 === this._$Ej?.get(t5) && !this.hasAttribute(r6._$Eu(t5, i8)))) return;
      this.C(t5, s5, i8);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t5, s5, { useDefault: i8, reflect: e6, wrapped: h4 }, r6) {
    i8 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t5) && (this._$Ej.set(t5, r6 ?? s5 ?? this[t5]), true !== h4 || void 0 !== r6) || (this._$AL.has(t5) || (this.hasUpdated || i8 || (s5 = void 0), this._$AL.set(t5, s5)), true === e6 && this._$Em !== t5 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t5));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t6) {
      Promise.reject(t6);
    }
    const t5 = this.scheduleUpdate();
    return null != t5 && await t5, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t7, s6] of this._$Ep) this[t7] = s6;
        this._$Ep = void 0;
      }
      const t6 = this.constructor.elementProperties;
      if (t6.size > 0) for (const [s6, i8] of t6) {
        const { wrapped: t7 } = i8, e6 = this[s6];
        true !== t7 || this._$AL.has(s6) || void 0 === e6 || this.C(s6, void 0, i8, e6);
      }
    }
    let t5 = false;
    const s5 = this._$AL;
    try {
      t5 = this.shouldUpdate(s5), t5 ? (this.willUpdate(s5), this._$EO?.forEach((t6) => t6.hostUpdate?.()), this.update(s5)) : this._$EM();
    } catch (s6) {
      throw t5 = false, this._$EM(), s6;
    }
    t5 && this._$AE(s5);
  }
  willUpdate(t5) {
  }
  _$AE(t5) {
    this._$EO?.forEach((t6) => t6.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t5)), this.updated(t5);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t5) {
    return true;
  }
  update(t5) {
    this._$Eq &&= this._$Eq.forEach((t6) => this._$ET(t6, this[t6])), this._$EM();
  }
  updated(t5) {
  }
  firstUpdated(t5) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// ../modules-workspace/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t5) => t5;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t5) => t5 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t5) => null === t5 || "object" != typeof t5 && "function" != typeof t5;
var u2 = Array.isArray;
var d2 = (t5) => u2(t5) || "function" == typeof t5?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t5) => (i8, ...s5) => ({ _$litType$: t5, strings: i8, values: s5 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = Symbol.for("lit-noChange");
var A = Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t5, i8) {
  if (!u2(t5) || !t5.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i8) : i8;
}
var N = (t5, i8) => {
  const s5 = t5.length - 1, e6 = [];
  let n6, l3 = 2 === i8 ? "<svg>" : 3 === i8 ? "<math>" : "", c5 = v;
  for (let i9 = 0; i9 < s5; i9++) {
    const s6 = t5[i9];
    let a3, u5, d3 = -1, f3 = 0;
    for (; f3 < s6.length && (c5.lastIndex = f3, u5 = c5.exec(s6), null !== u5); ) f3 = c5.lastIndex, c5 === v ? "!--" === u5[1] ? c5 = _ : void 0 !== u5[1] ? c5 = m : void 0 !== u5[2] ? (y2.test(u5[2]) && (n6 = RegExp("</" + u5[2], "g")), c5 = p2) : void 0 !== u5[3] && (c5 = p2) : c5 === p2 ? ">" === u5[0] ? (c5 = n6 ?? v, d3 = -1) : void 0 === u5[1] ? d3 = -2 : (d3 = c5.lastIndex - u5[2].length, a3 = u5[1], c5 = void 0 === u5[3] ? p2 : '"' === u5[3] ? $ : g) : c5 === $ || c5 === g ? c5 = p2 : c5 === _ || c5 === m ? c5 = v : (c5 = p2, n6 = void 0);
    const x2 = c5 === p2 && t5[i9 + 1].startsWith("/>") ? " " : "";
    l3 += c5 === v ? s6 + r3 : d3 >= 0 ? (e6.push(a3), s6.slice(0, d3) + h2 + s6.slice(d3) + o3 + x2) : s6 + o3 + (-2 === d3 ? i9 : x2);
  }
  return [V(t5, l3 + (t5[s5] || "<?>") + (2 === i8 ? "</svg>" : 3 === i8 ? "</math>" : "")), e6];
};
var S2 = class _S {
  constructor({ strings: t5, _$litType$: i8 }, e6) {
    let r6;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u5 = t5.length - 1, d3 = this.parts, [f3, v3] = N(t5, i8);
    if (this.el = _S.createElement(f3, e6), P.currentNode = this.el.content, 2 === i8 || 3 === i8) {
      const t6 = this.el.content.firstChild;
      t6.replaceWith(...t6.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d3.length < u5; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t6 of r6.getAttributeNames()) if (t6.endsWith(h2)) {
          const i9 = v3[a3++], s5 = r6.getAttribute(t6).split(o3), e7 = /([.?@])?(.*)/.exec(i9);
          d3.push({ type: 1, index: l3, name: e7[2], strings: s5, ctor: "." === e7[1] ? I : "?" === e7[1] ? L : "@" === e7[1] ? z : H }), r6.removeAttribute(t6);
        } else t6.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r6.removeAttribute(t6));
        if (y2.test(r6.tagName)) {
          const t6 = r6.textContent.split(o3), i9 = t6.length - 1;
          if (i9 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s5 = 0; s5 < i9; s5++) r6.append(t6[s5], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r6.append(t6[i9], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t6 = -1;
        for (; -1 !== (t6 = r6.data.indexOf(o3, t6 + 1)); ) d3.push({ type: 7, index: l3 }), t6 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t5, i8) {
    const s5 = l2.createElement("template");
    return s5.innerHTML = t5, s5;
  }
};
function M(t5, i8, s5 = t5, e6) {
  if (i8 === E) return i8;
  let h4 = void 0 !== e6 ? s5._$Co?.[e6] : s5._$Cl;
  const o7 = a2(i8) ? void 0 : i8._$litDirective$;
  return h4?.constructor !== o7 && (h4?._$AO?.(false), void 0 === o7 ? h4 = void 0 : (h4 = new o7(t5), h4._$AT(t5, s5, e6)), void 0 !== e6 ? (s5._$Co ??= [])[e6] = h4 : s5._$Cl = h4), void 0 !== h4 && (i8 = M(t5, h4._$AS(t5, i8.values), h4, e6)), i8;
}
var R = class {
  constructor(t5, i8) {
    this._$AV = [], this._$AN = void 0, this._$AD = t5, this._$AM = i8;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t5) {
    const { el: { content: i8 }, parts: s5 } = this._$AD, e6 = (t5?.creationScope ?? l2).importNode(i8, true);
    P.currentNode = e6;
    let h4 = P.nextNode(), o7 = 0, n6 = 0, r6 = s5[0];
    for (; void 0 !== r6; ) {
      if (o7 === r6.index) {
        let i9;
        2 === r6.type ? i9 = new k(h4, h4.nextSibling, this, t5) : 1 === r6.type ? i9 = new r6.ctor(h4, r6.name, r6.strings, this, t5) : 6 === r6.type && (i9 = new Z(h4, this, t5)), this._$AV.push(i9), r6 = s5[++n6];
      }
      o7 !== r6?.index && (h4 = P.nextNode(), o7++);
    }
    return P.currentNode = l2, e6;
  }
  p(t5) {
    let i8 = 0;
    for (const s5 of this._$AV) void 0 !== s5 && (void 0 !== s5.strings ? (s5._$AI(t5, s5, i8), i8 += s5.strings.length - 2) : s5._$AI(t5[i8])), i8++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t5, i8, s5, e6) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t5, this._$AB = i8, this._$AM = s5, this.options = e6, this._$Cv = e6?.isConnected ?? true;
  }
  get parentNode() {
    let t5 = this._$AA.parentNode;
    const i8 = this._$AM;
    return void 0 !== i8 && 11 === t5?.nodeType && (t5 = i8.parentNode), t5;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t5, i8 = this) {
    t5 = M(this, t5, i8), a2(t5) ? t5 === A || null == t5 || "" === t5 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t5 !== this._$AH && t5 !== E && this._(t5) : void 0 !== t5._$litType$ ? this.$(t5) : void 0 !== t5.nodeType ? this.T(t5) : d2(t5) ? this.k(t5) : this._(t5);
  }
  O(t5) {
    return this._$AA.parentNode.insertBefore(t5, this._$AB);
  }
  T(t5) {
    this._$AH !== t5 && (this._$AR(), this._$AH = this.O(t5));
  }
  _(t5) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t5 : this.T(l2.createTextNode(t5)), this._$AH = t5;
  }
  $(t5) {
    const { values: i8, _$litType$: s5 } = t5, e6 = "number" == typeof s5 ? this._$AC(t5) : (void 0 === s5.el && (s5.el = S2.createElement(V(s5.h, s5.h[0]), this.options)), s5);
    if (this._$AH?._$AD === e6) this._$AH.p(i8);
    else {
      const t6 = new R(e6, this), s6 = t6.u(this.options);
      t6.p(i8), this.T(s6), this._$AH = t6;
    }
  }
  _$AC(t5) {
    let i8 = C.get(t5.strings);
    return void 0 === i8 && C.set(t5.strings, i8 = new S2(t5)), i8;
  }
  k(t5) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i8 = this._$AH;
    let s5, e6 = 0;
    for (const h4 of t5) e6 === i8.length ? i8.push(s5 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s5 = i8[e6], s5._$AI(h4), e6++;
    e6 < i8.length && (this._$AR(s5 && s5._$AB.nextSibling, e6), i8.length = e6);
  }
  _$AR(t5 = this._$AA.nextSibling, s5) {
    for (this._$AP?.(false, true, s5); t5 !== this._$AB; ) {
      const s6 = i3(t5).nextSibling;
      i3(t5).remove(), t5 = s6;
    }
  }
  setConnected(t5) {
    void 0 === this._$AM && (this._$Cv = t5, this._$AP?.(t5));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t5, i8, s5, e6, h4) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t5, this.name = i8, this._$AM = e6, this.options = h4, s5.length > 2 || "" !== s5[0] || "" !== s5[1] ? (this._$AH = Array(s5.length - 1).fill(new String()), this.strings = s5) : this._$AH = A;
  }
  _$AI(t5, i8 = this, s5, e6) {
    const h4 = this.strings;
    let o7 = false;
    if (void 0 === h4) t5 = M(this, t5, i8, 0), o7 = !a2(t5) || t5 !== this._$AH && t5 !== E, o7 && (this._$AH = t5);
    else {
      const e7 = t5;
      let n6, r6;
      for (t5 = h4[0], n6 = 0; n6 < h4.length - 1; n6++) r6 = M(this, e7[s5 + n6], i8, n6), r6 === E && (r6 = this._$AH[n6]), o7 ||= !a2(r6) || r6 !== this._$AH[n6], r6 === A ? t5 = A : t5 !== A && (t5 += (r6 ?? "") + h4[n6 + 1]), this._$AH[n6] = r6;
    }
    o7 && !e6 && this.j(t5);
  }
  j(t5) {
    t5 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t5 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t5) {
    this.element[this.name] = t5 === A ? void 0 : t5;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t5) {
    this.element.toggleAttribute(this.name, !!t5 && t5 !== A);
  }
};
var z = class extends H {
  constructor(t5, i8, s5, e6, h4) {
    super(t5, i8, s5, e6, h4), this.type = 5;
  }
  _$AI(t5, i8 = this) {
    if ((t5 = M(this, t5, i8, 0) ?? A) === E) return;
    const s5 = this._$AH, e6 = t5 === A && s5 !== A || t5.capture !== s5.capture || t5.once !== s5.once || t5.passive !== s5.passive, h4 = t5 !== A && (s5 === A || e6);
    e6 && this.element.removeEventListener(this.name, this, s5), h4 && this.element.addEventListener(this.name, this, t5), this._$AH = t5;
  }
  handleEvent(t5) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t5) : this._$AH.handleEvent(t5);
  }
};
var Z = class {
  constructor(t5, i8, s5) {
    this.element = t5, this.type = 6, this._$AN = void 0, this._$AM = i8, this.options = s5;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t5) {
    M(this, t5);
  }
};
var j = { M: h2, P: o3, A: n3, C: 1, L: N, R, D: d2, V: M, I: k, H, N: L, U: z, B: I, F: Z };
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t5, i8, s5) => {
  const e6 = s5?.renderBefore ?? i8;
  let h4 = e6._$litPart$;
  if (void 0 === h4) {
    const t6 = s5?.renderBefore ?? null;
    e6._$litPart$ = h4 = new k(i8.insertBefore(c3(), t6), t6, void 0, s5 ?? {});
  }
  return h4._$AI(t5), h4;
};

// ../modules-workspace/node_modules/.pnpm/lit-element@4.2.2/node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t5 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t5.firstChild, t5;
  }
  update(t5) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t5), this._$Do = D(r6, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// ../modules-workspace/node_modules/.pnpm/@lit+reactive-element@2.1.2/node_modules/@lit/reactive-element/decorators/property.js
var o5 = { attribute: true, type: String, converter: u, reflect: false, hasChanged: f };
var r4 = (t5 = o5, e6, r6) => {
  const { kind: n6, metadata: i8 } = r6;
  let s5 = globalThis.litPropertyMetadata.get(i8);
  if (void 0 === s5 && globalThis.litPropertyMetadata.set(i8, s5 = /* @__PURE__ */ new Map()), "setter" === n6 && ((t5 = Object.create(t5)).wrapped = true), s5.set(r6.name, t5), "accessor" === n6) {
    const { name: o7 } = r6;
    return { set(r7) {
      const n7 = e6.get.call(this);
      e6.set.call(this, r7), this.requestUpdate(o7, n7, t5, true, r7);
    }, init(e7) {
      return void 0 !== e7 && this.C(o7, void 0, t5, e7), e7;
    } };
  }
  if ("setter" === n6) {
    const { name: o7 } = r6;
    return function(r7) {
      const n7 = this[o7];
      e6.call(this, r7), this.requestUpdate(o7, n7, t5, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n6);
};
function n4(t5) {
  return (e6, o7) => "object" == typeof o7 ? r4(t5, e6, o7) : ((t6, e7, o8) => {
    const r6 = e7.hasOwnProperty(o8);
    return e7.constructor.createProperty(o8, t6), r6 ? Object.getOwnPropertyDescriptor(e7, o8) : void 0;
  })(t5, e6, o7);
}

// ../modules-workspace/node_modules/.pnpm/@lit+reactive-element@2.1.2/node_modules/@lit/reactive-element/decorators/state.js
function r5(r6) {
  return n4({ ...r6, state: true, attribute: false });
}

// ../modules-workspace/node_modules/.pnpm/@outfitkit+core@file+..+outfitkit/node_modules/@outfitkit/core/dist/define.js
function define(tag, ctor) {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, ctor);
  }
}

// ../modules-workspace/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html/directive.js
var t3 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e5 = (t5) => (...e6) => ({ _$litDirective$: t5, values: e6 });
var i5 = class {
  constructor(t5) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t5, e6, i8) {
    this._$Ct = t5, this._$AM = e6, this._$Ci = i8;
  }
  _$AS(t5, e6) {
    return this.update(t5, e6);
  }
  update(t5, e6) {
    return this.render(...e6);
  }
};

// ../modules-workspace/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html/directive-helpers.js
var { I: t4 } = j;
var i6 = (o7) => o7;
var s4 = () => document.createComment("");
var v2 = (o7, n6, e6) => {
  const l3 = o7._$AA.parentNode, d3 = void 0 === n6 ? o7._$AB : n6._$AA;
  if (void 0 === e6) {
    const i8 = l3.insertBefore(s4(), d3), n7 = l3.insertBefore(s4(), d3);
    e6 = new t4(i8, n7, o7, o7.options);
  } else {
    const t5 = e6._$AB.nextSibling, n7 = e6._$AM, c5 = n7 !== o7;
    if (c5) {
      let t6;
      e6._$AQ?.(o7), e6._$AM = o7, void 0 !== e6._$AP && (t6 = o7._$AU) !== n7._$AU && e6._$AP(t6);
    }
    if (t5 !== d3 || c5) {
      let o8 = e6._$AA;
      for (; o8 !== t5; ) {
        const t6 = i6(o8).nextSibling;
        i6(l3).insertBefore(o8, d3), o8 = t6;
      }
    }
  }
  return e6;
};
var u3 = (o7, t5, i8 = o7) => (o7._$AI(t5, i8), o7);
var m2 = {};
var p3 = (o7, t5 = m2) => o7._$AH = t5;
var M2 = (o7) => o7._$AH;
var h3 = (o7) => {
  o7._$AR(), o7._$AA.remove();
};

// ../modules-workspace/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html/directives/repeat.js
var u4 = (e6, s5, t5) => {
  const r6 = /* @__PURE__ */ new Map();
  for (let l3 = s5; l3 <= t5; l3++) r6.set(e6[l3], l3);
  return r6;
};
var c4 = e5(class extends i5 {
  constructor(e6) {
    if (super(e6), e6.type !== t3.CHILD) throw Error("repeat() can only be used in text expressions");
  }
  dt(e6, s5, t5) {
    let r6;
    void 0 === t5 ? t5 = s5 : void 0 !== s5 && (r6 = s5);
    const l3 = [], o7 = [];
    let i8 = 0;
    for (const s6 of e6) l3[i8] = r6 ? r6(s6, i8) : i8, o7[i8] = t5(s6, i8), i8++;
    return { values: o7, keys: l3 };
  }
  render(e6, s5, t5) {
    return this.dt(e6, s5, t5).values;
  }
  update(s5, [t5, r6, c5]) {
    const d3 = M2(s5), { values: p4, keys: a3 } = this.dt(t5, r6, c5);
    if (!Array.isArray(d3)) return this.ut = a3, p4;
    const h4 = this.ut ??= [], v3 = [];
    let m3, y3, x2 = 0, j2 = d3.length - 1, k2 = 0, w2 = p4.length - 1;
    for (; x2 <= j2 && k2 <= w2; ) if (null === d3[x2]) x2++;
    else if (null === d3[j2]) j2--;
    else if (h4[x2] === a3[k2]) v3[k2] = u3(d3[x2], p4[k2]), x2++, k2++;
    else if (h4[j2] === a3[w2]) v3[w2] = u3(d3[j2], p4[w2]), j2--, w2--;
    else if (h4[x2] === a3[w2]) v3[w2] = u3(d3[x2], p4[w2]), v2(s5, v3[w2 + 1], d3[x2]), x2++, w2--;
    else if (h4[j2] === a3[k2]) v3[k2] = u3(d3[j2], p4[k2]), v2(s5, d3[x2], d3[j2]), j2--, k2++;
    else if (void 0 === m3 && (m3 = u4(a3, k2, w2), y3 = u4(h4, x2, j2)), m3.has(h4[x2])) if (m3.has(h4[j2])) {
      const e6 = y3.get(a3[k2]), t6 = void 0 !== e6 ? d3[e6] : null;
      if (null === t6) {
        const e7 = v2(s5, d3[x2]);
        u3(e7, p4[k2]), v3[k2] = e7;
      } else v3[k2] = u3(t6, p4[k2]), v2(s5, d3[x2], t6), d3[e6] = null;
      k2++;
    } else h3(d3[j2]), j2--;
    else h3(d3[x2]), x2++;
    for (; k2 <= w2; ) {
      const e6 = v2(s5, v3[w2 + 1]);
      u3(e6, p4[k2]), v3[k2++] = e6;
    }
    for (; x2 <= j2; ) {
      const e6 = d3[x2++];
      null !== e6 && h3(e6);
    }
    return this.ut = a3, p3(s5, v3), E;
  }
});

// ../modules-workspace/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html/directives/style-map.js
var n5 = "important";
var i7 = " !" + n5;
var o6 = e5(class extends i5 {
  constructor(t5) {
    if (super(t5), t5.type !== t3.ATTRIBUTE || "style" !== t5.name || t5.strings?.length > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
  }
  render(t5) {
    return Object.keys(t5).reduce((e6, r6) => {
      const s5 = t5[r6];
      return null == s5 ? e6 : e6 + `${r6 = r6.includes("-") ? r6 : r6.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${s5};`;
    }, "");
  }
  update(e6, [r6]) {
    const { style: s5 } = e6.element;
    if (void 0 === this.ft) return this.ft = new Set(Object.keys(r6)), this.render(r6);
    for (const t5 of this.ft) null == r6[t5] && (this.ft.delete(t5), t5.includes("-") ? s5.removeProperty(t5) : s5[t5] = null);
    for (const t5 in r6) {
      const e7 = r6[t5];
      if (null != e7) {
        this.ft.add(t5);
        const r7 = "string" == typeof e7 && e7.endsWith(i7);
        t5.includes("-") || r7 ? s5.setProperty(t5, r7 ? e7.slice(0, -11) : e7, r7 ? n5 : "") : s5[t5] = e7;
      }
    }
    return E;
  }
});

// ../modules-workspace/node_modules/.pnpm/@outfitkit+core@file+..+outfitkit/node_modules/@outfitkit/core/dist/ok-data-table.js
var __defProp2 = Object.defineProperty;
var __decorateClass2 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i8 = decorators.length - 1, decorator; i8 >= 0; i8--)
    if (decorator = decorators[i8])
      result = decorator(target, key, result) || result;
  if (result) __defProp2(target, key, result);
  return result;
};
var DEFAULT_LABELS = {
  search: "Search\u2026",
  empty: "No results",
  filters: "Filters",
  clear: "Clear",
  apply: "Apply",
  selected: "{n} selected",
  importCsv: "Import CSV",
  exportCsv: "Export CSV",
  add: "Add",
  moreActions: "More actions",
  rowsPerPage: "Rows per page",
  perPageShort: "{n} / page",
  viewList: "View as list",
  viewCards: "View as cards",
  columnsVisible: "Visible columns",
  columns: "Columns",
  actions: "Actions",
  close: "Close",
  newRecord: "New",
  form: "Form",
  filterPlaceholder: "Filter\u2026",
  from: "From",
  to: "To",
  fromOf: "{label} from",
  toOf: "{label} to",
  gte: "\u2265",
  lte: "\u2264",
  noValues: "No values",
  selectAll: "Select all",
  selectRow: "Select row",
  select: "Select",
  showing: "Showing {from}\u2013{to} of",
  recordSingular: "record",
  recordPlural: "records"
};
var OkDataTable = class extends i4 {
  constructor() {
    super(...arguments);
    this.columns = [];
    this.rows = [];
    this.searchKeys = [];
    this.rowKeyField = "id";
    this.pageSize = 10;
    this.labels = {};
    this.actions = [];
    this.addable = false;
    this.pageSizeOptions = [10, 25, 50, 100];
    this.fill = false;
    this.columnPicker = true;
    this.csv = false;
    this.csvName = "export.csv";
    this.serverSide = false;
    this.total = 0;
    this.page = 0;
    this.searchable = false;
    this.sortDir = "asc";
    this.title = "";
    this.views = false;
    this.exportable = false;
    this.importable = false;
    this.columnSelector = false;
    this.selectable = false;
    this.inlineFilters = false;
    this.menuActions = [];
    this.q = "";
    this.clientPage = 0;
    this.clientPageSize = 0;
    this.clientSort = "";
    this.clientSortDir = "asc";
    this.clientFilters = {};
    this.filterDraft = {};
    this.panel = "none";
    this.viewMode = "table";
    this.hiddenKeys = /* @__PURE__ */ new Set();
    this.internalSelection = /* @__PURE__ */ new Set();
    this.menuOpen = false;
    this.onSearch = (ev) => {
      const value = ev.target.value ?? "";
      if (this.serverSide) {
        this.emit("searchChange", value);
      } else {
        this.q = value;
        this.clientPage = 0;
      }
    };
  }
  static {
    this.styles = i`
    :host {
      /* Vars overridable (estilo Ionic), default = cadena --ok-* → --ion-* → hex */
      --background: var(--ok-surface, var(--ion-card-background, var(--ion-background-color, #ffffff)));
      --color: var(--ok-text, var(--ion-text-color, #1c1b17));
      --color-muted: var(--ok-muted, var(--ion-color-medium, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.55)));
      --border-color: var(--ok-border, var(--ion-color-step-150, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.12)));
      --border-color-soft: var(--ok-border-soft, var(--ion-color-step-100, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.07)));
      /* Borde más marcado para los controles de la toolbar (selects/pastilla de fechas), para que se
       * distingan como controles en claro y oscuro aunque el lienzo y la superficie casi no contrasten. */
      --control-border: color-mix(in srgb, var(--color) 22%, transparent);
      /* Relieve de cabecera/pie: step-100 (definido en claro y oscuro) → contraste con el lienzo. */
      --header-background: var(--ok-surface-2, var(--ion-color-step-100, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.04)));
      --row-hover: var(--ok-row-hover, var(--ion-color-step-50, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.03)));
      --primary: var(--ok-primary, var(--ion-color-primary, #3880ff));
      --primary-contrast: var(--ok-primary-contrast, var(--ion-color-primary-contrast, #ffffff));
      --border-radius: var(--ok-radius, 16px);
      --font: var(--ok-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);

      display: block;
      color: var(--color);
      font-family: var(--font);
    }
    * { box-sizing: border-box; }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      /* Flat: sin borde ni elevación (directiva 2026-06-09). */
      border: 0;
      border-radius: var(--border-radius);
      overflow: hidden;
      background: var(--background);
      box-shadow: none;
    }

    /* Panel lateral derecho (drawer) DENTRO de la tabla: filtros / alta-edición. No empuja contenido. */
    .tk-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.18); z-index: 19; }
    .drawer { position: absolute; top: 0; right: 0; height: 100%; width: 340px; max-width: 88%;
      background: var(--background); border-left: 1px solid var(--border-color);
      box-shadow: -10px 0 28px rgba(0, 0, 0, 0.10); display: flex; flex-direction: column; z-index: 20;
      animation: tk-slide-in 0.18s ease; }
    @keyframes tk-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
    .drawer .dh { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
      padding: 0.6rem 0.5rem 0.6rem 1rem; border-bottom: 1px solid var(--border-color); font-size: 1rem; }
    .drawer .db { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem; }
    .fblock { display: flex; flex-direction: column; gap: 0.45rem; }
    .flabel { font-size: 13px; font-weight: 500; color: var(--color); }
    .frange { display: flex; gap: 0.5rem; }
    /* Filtros cliente: chips multi-select (estilo Hub) + rango de fechas. */
    .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.6rem; border: 1px solid var(--border-color); border-radius: 999px; background: var(--background); color: var(--color-muted); font-size: 12px; cursor: pointer; transition: color 0.12s, background 0.12s, border-color 0.12s; }
    .chip:hover { color: var(--color); }
    .chip.on { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 15%, transparent); }
    .chip ion-icon { font-size: 12px; }
    .chip-empty { font-size: 12px; color: var(--color-muted); }
    .daterange { display: flex; gap: 0.6rem; }
    .daterange ion-input { flex: 1; }
    /* Pie del drawer de filtros: Limpiar / Aplicar. */
    .df { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 0.4rem; padding: 0.6rem 0.85rem; border-top: 1px solid var(--border-color); }
    .df .df-clear { margin-right: auto; }

    /* Modo fill: la tabla ocupa el alto del contenedor; filas con scroll interno; pager fijo. */
    :host([fill]) { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    :host([fill]) .card { flex: 1 1 auto; min-height: 0; }
    :host([fill]) .bar, :host([fill]) .panel, :host([fill]) .pager { flex: 0 0 auto; }
    :host([fill]) .scroll, :host([fill]) .cards-grid { flex: 1 1 auto; min-height: 0; overflow: auto; }

    /* ── Topbar / cabecera (relieve) ─────────────────────────────────────────────────────── */
    .bar { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.65rem 1rem; border-bottom: 1px solid var(--border-color); background: var(--header-background); }
    /* Toolbar CONSOLIDADA: TODOS los controles son hijos directos de UNA sola fila flex que
     * envuelve ELEMENTO A ELEMENTO (no por bloques): caben en una línea → una línea; los que no
     * caben bajan a la(s) línea(s) que hagan falta. El cluster derecho se empuja al borde con
     * .tk-spacer (hueco flexible) solo cuando todo cabe en una línea; al envolver, el spacer se
     * oculta y todo se apila a la izquierda.
     * ORDEN CANÓNICO (2026-06-22, izquierda→derecha): [buscador] · [filtros en línea] · ‹spacer› ·
     * [SELECTORES: columnas → filas/página] · [BOTONES: vistas → filtros(funnel) → import → export →
     * alta → ⋮ → acción primaria]. Es decir: buscador al inicio, filtros en medio, y al final los
     * selectores (columnas, luego «N por página») seguidos de los botones de acción. */
    .bar-main { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .bar-main > ion-button { --padding-start: 0.5rem; --padding-end: 0.5rem; margin: 0; }
    /* Spacer que absorbe el hueco libre en pantallas anchas (empuja el cluster derecho al borde).
     * Se oculta por debajo de 1024px para que, al envolver, los controles se apilen a la izquierda. */
    .tk-spacer { flex: 1 1 0; min-width: 0; align-self: stretch; }
    @media (max-width: 1024px) { .tk-spacer { display: none; } }
    /* Buscador a ancho completo (línea propia) en móvil; el resto envuelve debajo. */
    @media (max-width: 640px) { .search { flex-basis: 100%; max-width: none; } }
    .title-wrap { display: flex; align-items: baseline; gap: 0.5rem; }
    .title { font-size: 15px; font-weight: 600; line-height: 1; margin: 0; }
    .title-count { font-size: 12px; font-weight: 500; color: var(--color-muted); }

    /* Botón de herramienta cuadrado (filtros/import/export), look del Hub: 36×36, badge contador. */
    .toolbtn { position: relative; --padding-start: 0; --padding-end: 0; --border-radius: 10px; width: 36px; height: 36px; margin: 0; }
    .toolbtn .badge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 999px; background: var(--primary); color: var(--primary-contrast); font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; pointer-events: none; }

    /* Buscador (caja con icono + limpiar), look del Hub. No crece (el spacer se queda el hueco);
     * puede encoger hasta min-width y, por debajo, envuelve. */
    .search { flex: 0 1 22rem; min-width: 12rem; max-width: 24rem; }
    ion-searchbar { --background: var(--background); --border-radius: 10px; padding: 0; min-height: 36px; }
    /* Flat: el buscador quita borde y elevación vía la clase específica de Ionic 'ion-no-border'.
     * (La regla global de Ionic para .ion-no-border no cruza el Shadow DOM, así que la
     * reimplementamos aquí dentro: --box-shadow controla la elevación; ::part(native) el borde.) */
    ion-searchbar.ion-no-border { --box-shadow: none; }
    ion-searchbar.ion-no-border::part(native) { border: none; box-shadow: none; }

    /* Toggle de vista lista/tarjetas (segmento) */
    .viewseg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--background); }
    .viewseg ion-button { --border-radius: 7px; }

    /* Botón primario (primaryAction) */
    .primary-btn { --background: var(--primary); --color: var(--primary-contrast); }

    /* Selects de la toolbar: fondo + borde visibles (como el buscador y la pastilla de fechas) para
     * que se distingan como controles en claro y oscuro (sin fondo eran invisibles en dark). */
    .tk-cols { min-width: 6.5rem; max-width: 9rem; min-height: 38px; font-size: 13px; background: var(--background); color: var(--color); border: 1px solid var(--control-border); border-radius: 10px; --padding-start: 0.6rem; --padding-end: 0.4rem; --padding-top: 0.3rem; --padding-bottom: 0.3rem; }
    .vsep { width: 1px; align-self: stretch; background: var(--border-color); margin: 0.3rem 0.25rem; }

    /* Selector de filas/página en la toolbar (consolidado) */
    /* max-width: ion-select es display:block (sin core.css el host estira a la
     * línea entera cuando .bar-end hace wrap) — se capa como .tk-cols. */
    .tk-psize { min-width: 4.25rem; max-width: 5.5rem; min-height: 38px; font-size: 13px; background: var(--background); color: var(--color); border: 1px solid var(--control-border); border-radius: 10px; --padding-start: 0.6rem; --padding-end: 0.4rem; --padding-top: 0.35rem; --padding-bottom: 0.35rem; }

    /* Filtros EN LÍNEA en la toolbar (select / rango de fechas) */
    .tk-filter { min-width: 8.5rem; max-width: 13rem; min-height: 38px; font-size: 13px; background: var(--background); color: var(--color); border: 1px solid var(--control-border); border-radius: 10px; --padding-start: 0.7rem; --padding-end: 0.5rem; --padding-top: 0.35rem; --padding-bottom: 0.35rem; }
    .tk-daterange { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.6rem; min-height: 38px; border: 1px solid var(--control-border); border-radius: 10px; background: var(--background); color: var(--color-muted); font-size: 13px; }
    .tk-daterange ion-icon { font-size: 15px; flex: 0 0 auto; }
    .tk-daterange ion-input { --background: transparent; --padding-start: 0; --padding-end: 0; --padding-top: 2px; --padding-bottom: 2px; --color: var(--color); min-height: 26px; width: 6.8rem; font-size: 13px; }
    .tk-daterange .arr { color: var(--color-muted); }

    /* Barra contextual de selección */
    .selbar { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.7rem; border-radius: 10px;
      font-size: 13px; color: var(--primary);
      background: color-mix(in srgb, var(--primary) 12%, transparent); }
    .selbar .sel-clear { margin-left: auto; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; font-weight: 500; color: inherit; background: none; border: 0; font: inherit; }
    .selbar .sel-clear:hover { text-decoration: underline; }

    /* Acordeones (alta / filtros en modo tarjetas) */
    .panel { padding: 0.85rem 1rem; border-bottom: 1px solid var(--border-color); background: var(--header-background); }
    .filters-panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }

    /* ── Vista lista en CSS GRID (no <table>): permite ancho por columna ──────────────────── */
    .scroll { overflow-x: auto; }
    .grid { min-width: max-content; font-size: 14px; }
    .grow { display: grid; align-items: center; gap: 0.5rem; padding: 0 1rem; }
    .ghead { position: sticky; top: 0; z-index: 2; border-bottom: 1px solid var(--border-color);
      background: var(--header-background); padding-top: 0.55rem; padding-bottom: 0.55rem; }
    .gcell { display: flex; align-items: center; min-width: 0; }
    .gcell > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gcell.right { justify-content: flex-end; text-align: right; }
    .gcell.center { justify-content: center; text-align: center; }
    .gh { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); }
    .gh.sortable { cursor: pointer; user-select: none; white-space: nowrap; transition: background-color var(--ok-transition, 150ms ease), color var(--ok-transition, 150ms ease), box-shadow var(--ok-transition, 150ms ease), transform 120ms ease; }
    @media (hover: hover) {
      .gh.sortable:hover { color: var(--color); }
    }
    /* Caret de orden (3 estados, icono Ionic): neutral atenuado / activo en color primario. */
    .caret { display: inline-flex; align-items: center; margin-left: 0.25rem; flex: 0 0 auto; font-size: 13px; opacity: 0.3; }
    .caret.on { opacity: 1; color: var(--primary); }
    .grow-data { border-bottom: 1px solid var(--border-color-soft); padding-top: 0.6rem; padding-bottom: 0.6rem; transition: background-color var(--ok-transition, 150ms ease), color var(--ok-transition, 150ms ease), box-shadow var(--ok-transition, 150ms ease), transform 120ms ease; }
    .grow-data:last-child { border-bottom: 0; }
    @media (hover: hover) {
      .grow-data:hover { background: var(--row-hover); }
    }
    .grow-data:active { transform: scale(0.995); }
    .grow-data.selected { background: color-mix(in srgb, var(--primary) 10%, transparent); }
    .selcb { display: flex; align-items: center; justify-content: center; }
    .filters-grow { padding-top: 0.4rem; padding-bottom: 0.6rem; }
    .filters-grow input, .filters-grow select { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; padding: 0.3rem 0.4rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--background); color: var(--color); }
    .range { display: flex; gap: 0.25rem; }

    /* ── Vista tarjetas ──────────────────────────────────────────────────────────────────── */
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.75rem; padding: 1rem; }
    /* Flat: sin borde ni elevación — las tarjetas se delimitan por la superficie (no por sombra). */
    .rcard { display: flex; flex-direction: column; border: 0; border-radius: 12px; overflow: hidden; background: var(--header-background); box-shadow: none; transition: background-color var(--ok-transition, 150ms ease), color var(--ok-transition, 150ms ease), box-shadow var(--ok-transition, 150ms ease), transform 120ms ease; }
    @media (hover: hover) {
      .rcard:hover { background: var(--row-hover); }
    }
    .rcard:active { transform: scale(0.995); }
    @media (prefers-reduced-motion: reduce) {
      .gh.sortable:hover, .gh.sortable:active,
      .grow-data:hover, .grow-data:active,
      .rcard:hover, .rcard:active { transform: none; }
    }
    .rcard.selected { background: color-mix(in srgb, var(--primary) 12%, var(--header-background)); }
    .rcard-head { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--border-color); background: var(--header-background); }
    .rcard-head .rc-icon { display: inline-flex; color: var(--primary); }
    .rcard-head .rc-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .rcard-body { flex: 1; padding: 0.6rem 0.85rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .rrow { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 13px; }
    .rrow .rk { color: var(--color-muted); }
    .rrow .rv { font-weight: 500; text-align: right; }
    .ractions { display: flex; justify-content: flex-end; gap: 0.25rem; padding: 0.25rem 0.5rem; border-top: 1px solid var(--border-color-soft); background: var(--header-background); }

    /* ── Estado vacío ────────────────────────────────────────────────────────────────────── */
    .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 3.5rem 1rem; text-align: center; color: var(--color-muted); }
    .empty .empty-ic { display: grid; place-items: center; width: 3.25rem; height: 3.25rem; border-radius: 999px; background: var(--header-background); font-size: 26px; }

    .actions { display: flex; gap: 0.25rem; justify-content: flex-end; }

    /* ── Pie: contador + paginación ──────────────────────────────────────────────────────── */
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.55rem 1rem; border-top: 1px solid var(--border-color); background: var(--header-background); font-size: 12.5px; color: var(--color-muted); }
    .pager .left { display: flex; align-items: center; gap: 0.6rem; }
    .pager .strong { font-weight: 600; color: var(--color); }
    .psize { font: inherit; font-size: 12.5px; padding: 0.2rem 0.35rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--background); color: var(--color); }
    .pager .nav { display: flex; align-items: center; gap: 0.2rem; }
    .pager .nav .pp { font-weight: 600; color: var(--color); padding: 0 0.25rem; }
    /* Pager numerado: botón por página + «…» en los saltos (look del Hub). */
    .pnum { min-width: 1.75rem; height: 1.75rem; padding: 0 0.4rem; border: 1px solid transparent; border-radius: 8px; background: none; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--color); cursor: pointer; transition: background 0.12s, border-color 0.12s; }
    .pnum:hover { background: var(--row-hover); }
    .pnum.on { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); border-color: color-mix(in srgb, var(--primary) 40%, transparent); }
    .pgap { padding: 0 0.15rem; color: var(--color-muted); }
    ion-button { --box-shadow: none; }
  `;
  }
  // ── i18n: textos efectivos (default inglés ← overrides de `.labels`) ──────────────────────
  get t() {
    return { ...DEFAULT_LABELS, ...this.labels };
  }
  /** Placeholder efectivo del buscador (prop explícita → label i18n → default inglés). */
  get effSearchPlaceholder() {
    return this.searchPlaceholder ?? this.t.search;
  }
  /** Mensaje efectivo de estado vacío (prop explícita → label i18n → default inglés). */
  get effEmptyMessage() {
    return this.emptyMessage ?? this.t.empty;
  }
  // ── Resolución de alias (compat + documentados) ──────────────────────────────────────────
  get effPageSizes() {
    return this.pageSizes ?? this.pageSizeOptions;
  }
  get effColumnPicker() {
    return this.columnPicker || this.columnSelector;
  }
  get effExport() {
    return this.csv || this.exportable;
  }
  get effImport() {
    return this.csv || this.importable;
  }
  /** ¿Está habilitado el conmutador de vista lista/tarjetas? */
  get viewToggle() {
    if (Array.isArray(this.views)) return this.views.length > 1;
    return this.views === true;
  }
  /** ¿Está disponible la vista tarjetas? (presente en `views` o `views === true`). */
  get cardViewEnabled() {
    if (Array.isArray(this.views)) return this.views.some((v3) => v3 === "cards" || v3 === "card");
    return this.views === true;
  }
  /** Columnas actualmente visibles (respeta el column chooser). */
  get visibleColumns() {
    return this.hiddenKeys.size ? this.columns.filter((c5) => !this.hiddenKeys.has(c5.key)) : this.columns;
  }
  setVisibleColumns(keys) {
    const visible = new Set(keys);
    this.hiddenKeys = new Set(this.columns.map((c5) => c5.key).filter((k2) => !visible.has(k2)));
    this.emit("columnsChange", { visible: keys });
  }
  // ── Selección ─────────────────────────────────────────────────────────────────────────────
  keyOf(row) {
    if (typeof this.rowKey === "function") return String(this.rowKey(row) ?? "");
    if (typeof this.rowKey === "string") return String(row[this.rowKey] ?? "");
    return String(row[this.rowKeyField] ?? "");
  }
  get selection() {
    return this.selectedKeys ?? this.internalSelection;
  }
  setSelection(next) {
    if (!this.selectedKeys) this.internalSelection = next;
    this.emit("selectionChange", { keys: [...next] });
    this.requestUpdate();
  }
  toggleRow(key) {
    const next = new Set(this.selection);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.setSelection(next);
  }
  toggleAll(visible) {
    const keys = visible.map((r6) => this.keyOf(r6));
    const allOn = keys.length > 0 && keys.every((k2) => this.selection.has(k2));
    const next = new Set(this.selection);
    if (allOn) keys.forEach((k2) => next.delete(k2));
    else keys.forEach((k2) => next.add(k2));
    this.setSelection(next);
  }
  // ── CSV ─────────────────────────────────────────────────────────────────────────────────────
  csvEscape(v3) {
    const s5 = v3 === null || v3 === void 0 ? "" : String(v3);
    return /[",\n\r]/.test(s5) ? `"${s5.replace(/"/g, '""')}"` : s5;
  }
  /** Exporta las filas a CSV (cabeceras = column.key). Si no hay filas, exporta solo la estructura. */
  exportCsv() {
    const cols = this.columns;
    const head = cols.map((c5) => this.csvEscape(c5.key)).join(",");
    const lines = this.rows.map((r6) => cols.map((c5) => this.csvEscape(r6[c5.key])).join(","));
    const csv = [head, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a3 = document.createElement("a");
    a3.href = url;
    a3.download = this.csvName;
    a3.click();
    URL.revokeObjectURL(url);
    this.emit("csvExport", { rows: this.rows.length });
    this.emit("export", { rows: this.rows.length });
  }
  parseCsv(text) {
    const out = [];
    let row = [];
    let field = "";
    let q = false;
    for (let i8 = 0; i8 < text.length; i8++) {
      const c5 = text[i8];
      if (q) {
        if (c5 === '"') {
          if (text[i8 + 1] === '"') {
            field += '"';
            i8++;
          } else q = false;
        } else field += c5;
      } else if (c5 === '"') q = true;
      else if (c5 === ",") {
        row.push(field);
        field = "";
      } else if (c5 === "\n" || c5 === "\r") {
        if (c5 === "\r" && text[i8 + 1] === "\n") i8++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") out.push(row);
        row = [];
      } else field += c5;
    }
    if (field !== "" || row.length) {
      row.push(field);
      out.push(row);
    }
    const headers = out.shift() ?? [];
    const rows = out.map((r6) => Object.fromEntries(headers.map((h4, i8) => [h4, r6[i8] ?? ""])));
    return { headers, rows };
  }
  async onImportFile(ev) {
    const input = ev.target;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { headers, rows } = this.parseCsv(text);
    this.emit("csvImport", { headers, rows });
    this.emit("import", { headers, rows });
    input.value = "";
  }
  toggle(p4) {
    if (p4 === "filters" && this.panel !== "filters") {
      this.filterDraft = this.cloneFilters(this.clientFilters);
    }
    this.panel = this.panel === p4 ? "none" : p4;
  }
  // ── Filtros en memoria (modo cliente): borrador → aplicar. ───────────────────────────────────
  cloneFilters(src) {
    const out = {};
    for (const [k2, f3] of Object.entries(src)) {
      out[k2] = { values: f3.values ? new Set(f3.values) : void 0, from: f3.from, to: f3.to };
    }
    return out;
  }
  toggleFilterValue(key, value) {
    const next = this.cloneFilters(this.filterDraft);
    const values = new Set(next[key]?.values ?? []);
    if (values.has(value)) values.delete(value);
    else values.add(value);
    next[key] = { ...next[key], values };
    this.filterDraft = next;
  }
  setFilterRange(key, edge, value) {
    const next = this.cloneFilters(this.filterDraft);
    next[key] = { ...next[key], [edge]: value };
    this.filterDraft = next;
  }
  applyFilters() {
    const clean = {};
    for (const [k2, f3] of Object.entries(this.filterDraft)) {
      if (f3.values && f3.values.size > 0 || f3.from || f3.to) clean[k2] = f3;
    }
    this.clientFilters = clean;
    this.clientPage = 0;
    this.panel = "none";
    this.emit("filterChange", { filters: this.serializeFilters(clean) });
  }
  clearFilters() {
    this.filterDraft = {};
  }
  serializeFilters(src) {
    const out = {};
    for (const [k2, f3] of Object.entries(src)) {
      if (f3.values && f3.values.size > 0) out[k2] = [...f3.values];
      else if (f3.from || f3.to) out[k2] = { from: f3.from ?? "", to: f3.to ?? "" };
    }
    return out;
  }
  /** Abre el panel lateral (API pública para el módulo, p.ej. "editar" abre el form pre-rellenado). */
  open(panel = "create") {
    this.panel = panel;
  }
  /** Cierra el panel lateral. */
  close() {
    this.panel = "none";
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  get hasSearch() {
    return this.searchable || this.searchKeys.length > 0;
  }
  /** Columnas filtrables (con control en el panel de filtros). En cliente y en servidor. */
  get filterColumns() {
    return this.columns.filter((c5) => c5.filterable);
  }
  /** ¿Hay que mostrar el botón de Filtros? (cualquier columna filtrable). */
  get hasFilterRow() {
    return this.filterColumns.length > 0;
  }
  /** Nº de filtros activos (modo cliente) → badge del botón Filtros. */
  get activeFilterCount() {
    return Object.values(this.clientFilters).filter(
      (f3) => f3.values && f3.values.size > 0 || f3.from || f3.to
    ).length;
  }
  /** Valor crudo de una columna para ordenar/filtrar (usa format si lo hay, si no row[key]). */
  rawValue(col, row) {
    if (col.format) return col.format(row);
    return row[col.key];
  }
  /** Valores distintos de una columna (para los chips del filtro multi-select). */
  distinctValues(col) {
    const set = /* @__PURE__ */ new Set();
    for (const row of this.rows) {
      const v3 = this.rawValue(col, row);
      if (v3 != null && v3 !== "") set.add(String(v3));
    }
    return [...set].sort((a3, b3) => a3.localeCompare(b3));
  }
  /** Filas tras buscar + filtrar + ordenar EN MEMORIA (solo modo cliente). */
  get clientFiltered() {
    let result = this.rows;
    const needle = this.q.trim().toLowerCase();
    if (needle && this.searchKeys.length) {
      result = result.filter(
        (r6) => this.searchKeys.some((k2) => String(r6[k2] ?? "").toLowerCase().includes(needle))
      );
    }
    const fkeys = Object.keys(this.clientFilters);
    if (fkeys.length) {
      result = result.filter(
        (row) => fkeys.every((key) => {
          const f3 = this.clientFilters[key];
          const col = this.columns.find((c5) => c5.key === key);
          if (!col) return true;
          if (f3.values && f3.values.size > 0) {
            return f3.values.has(String(this.rawValue(col, row) ?? ""));
          }
          if (f3.from || f3.to) {
            const raw = this.rawValue(col, row);
            const t5 = raw == null ? NaN : new Date(raw).getTime();
            const from = f3.from ? new Date(f3.from).getTime() : -Infinity;
            const to = f3.to ? new Date(f3.to).getTime() + 864e5 - 1 : Infinity;
            return !Number.isNaN(t5) && t5 >= from && t5 <= to;
          }
          return true;
        })
      );
    }
    if (this.clientSort) {
      const col = this.columns.find((c5) => c5.key === this.clientSort);
      if (col) {
        const dir = this.clientSortDir === "asc" ? 1 : -1;
        result = [...result].sort((a3, b3) => {
          const va = this.rawValue(col, a3);
          const vb = this.rawValue(col, b3);
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
          return 0;
        });
      }
    }
    return result;
  }
  cell(col, row) {
    if (col.format) return col.format(row);
    const v3 = row[col.key];
    return v3 === null || v3 === void 0 ? "" : String(v3);
  }
  /** ¿Es ordenable la columna? Servidor: opt-in (`sortable`). Cliente: por defecto SÍ (como el Hub),
   *  salvo `sortable: false` explícito. */
  isSortable(col) {
    return this.serverSide ? !!col.sortable : col.sortable !== false;
  }
  onHeaderClick(col) {
    if (!this.isSortable(col)) return;
    if (this.serverSide) {
      const dir = this.sort === col.key && this.sortDir === "asc" ? "desc" : "asc";
      this.emit("sortChange", { sort: col.key, dir });
      return;
    }
    if (this.clientSort === col.key) {
      this.clientSortDir = this.clientSortDir === "asc" ? "desc" : "asc";
    } else {
      this.clientSort = col.key;
      this.clientSortDir = "asc";
    }
  }
  onFilterInput(col, ev) {
    const value = ev.target.value ?? "";
    this.emit("filterChange", { col: col.key, value });
  }
  onRangeInput(col, edge, ev) {
    const raw = ev.target.value ?? "";
    const v3 = raw === "" ? "" : Number(raw);
    this.emit("filterChange", { col: col.key, value: { [edge]: v3 } });
  }
  onDateRangeInput(col, edge, ev) {
    const v3 = ev.target.value ?? "";
    this.emit("filterChange", { col: col.key, value: { [edge]: v3 } });
  }
  // ── Filtros EN LÍNEA (toolbar) ────────────────────────────────────────────────────────────
  // En modo cliente escriben directamente `clientFilters` (filtran en memoria); en servidor solo
  // emiten `filterChange`. Reutilizan la misma forma de filtro que el drawer (values / from / to).
  setClientFilter(key, patch) {
    const next = { ...this.clientFilters };
    const merged = { ...next[key], ...patch };
    const empty = (!merged.values || merged.values.size === 0) && !merged.from && !merged.to;
    if (empty) delete next[key];
    else next[key] = merged;
    this.clientFilters = next;
    this.clientPage = 0;
  }
  // ion-select (select/multiselect) del panel de filtros (renderFilterControl). En servidor emite
  // `filterChange`; en cliente escribe `clientFilters` (multiselect ⇒ filtra por inclusión).
  onFilterSelect(col, value, multi) {
    if (this.serverSide) {
      this.emit("filterChange", { col: col.key, value: value ?? (multi ? [] : "") });
      return;
    }
    if (multi) {
      const arr = Array.isArray(value) ? value.map((v3) => String(v3)) : value != null && value !== "" ? [String(value)] : [];
      this.setClientFilter(col.key, { values: arr.length ? new Set(arr) : void 0 });
    } else {
      const v3 = String(value ?? "");
      this.setClientFilter(col.key, { values: v3 ? /* @__PURE__ */ new Set([v3]) : void 0 });
    }
  }
  onInlineRange(col, edge, ev) {
    const v3 = ev.target.value ?? "";
    if (this.serverSide) {
      this.emit("filterChange", { col: col.key, value: { [edge]: v3 } });
      return;
    }
    this.setClientFilter(col.key, { [edge]: v3 || void 0 });
  }
  // Menú overflow: ancla el popover al botón vía el evento de click (compatible con Shadow DOM).
  openMenu(ev) {
    this.menuEv = ev;
    this.menuOpen = true;
  }
  setViewMode(mode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.emit("viewChange", mode);
  }
  // Control de filtro de una columna, con componentes Ionic (mismos inputs que el form de alta).
  renderFilterControl(col) {
    if (!col.filterable) return A;
    const type = col.filterType ?? "text";
    if (type === "select" || type === "multiselect") {
      const multi = type === "multiselect";
      const opts = col.options ?? this.distinctValues(col).map((v3) => ({ value: v3, label: v3 }));
      return b2`
        <ion-select
          label=${col.header}
          label-placement="stacked"
          ?multiple=${multi}
          interface="modal"
          .interfaceOptions=${{ cssClass: "ok-overlay" }}
          placeholder=${col.header}
          @ionChange=${(e6) => this.onFilterSelect(col, e6.detail.value, multi)}
        >
          ${multi ? A : b2`<ion-select-option value="">${col.header}</ion-select-option>`}
          ${opts.map((o7) => b2`<ion-select-option value=${o7.value}>${o7.label}</ion-select-option>`)}
        </ion-select>
      `;
    }
    if (type === "range" || type === "daterange") {
      const t5 = type === "daterange" ? "date" : "number";
      const onEdge = type === "daterange" ? this.onDateRangeInput.bind(this) : this.onRangeInput.bind(this);
      return b2`
        <div class="fblock">
          <span class="flabel">${col.header}</span>
          <div class="frange">
            <ion-input type=${t5} fill="outline" placeholder=${type === "daterange" ? this.t.from : this.t.gte}
              @ionInput=${(e6) => onEdge(col, "from", e6)}></ion-input>
            <ion-input type=${t5} fill="outline" placeholder=${type === "daterange" ? this.t.to : this.t.lte}
              @ionInput=${(e6) => onEdge(col, "to", e6)}></ion-input>
          </div>
        </div>
      `;
    }
    const inputType = type === "number" ? "number" : type === "date" ? "date" : "text";
    return b2`
      <ion-input
        type=${inputType}
        fill="outline"
        label=${col.header}
        label-placement="stacked"
        placeholder=${this.t.filterPlaceholder}
        @ionInput=${(e6) => this.onFilterInput(col, e6)}
      ></ion-input>
    `;
  }
  // Controles de filtro COMPACTOS para la toolbar (modo `inlineFilters`). Solo select y rango de
  // fechas (los del screenshot); el resto de tipos siguen disponibles vía el drawer si no se activa
  // `inlineFilters`. Look: «Todos los Estados» (placeholder) / «01/10/25 → 18/10/25».
  renderInlineFilters() {
    const cols = this.filterColumns.filter((c5) => {
      const t5 = c5.filterType ?? "text";
      return t5 === "select" || t5 === "multiselect" || t5 === "date" || t5 === "daterange";
    });
    if (!cols.length) return A;
    return b2`${cols.map((c5) => this.renderInlineFilter(c5))}`;
  }
  renderInlineFilter(col) {
    const type = col.filterType ?? "text";
    const f3 = this.clientFilters[col.key];
    if (type === "select" || type === "multiselect") {
      const multi = type === "multiselect";
      const opts = col.options ?? this.distinctValues(col).map((v3) => ({ value: v3, label: v3 }));
      const current = multi ? [...f3?.values ?? /* @__PURE__ */ new Set()] : f3?.values && f3.values.size ? [...f3.values][0] : "";
      return b2`
        <ion-select
          class="tk-filter"
          ?multiple=${multi}
          interface="modal"
          .interfaceOptions=${{ cssClass: "ok-overlay" }}
          aria-label=${col.header}
          placeholder=${col.header}
          .value=${current}
          @ionChange=${(e6) => this.onFilterSelect(col, e6.detail.value, multi)}
        >
          ${multi ? A : b2`<ion-select-option value="">${col.header}</ion-select-option>`}
          ${opts.map((o7) => b2`<ion-select-option value=${o7.value}>${o7.label}</ion-select-option>`)}
        </ion-select>
      `;
    }
    return b2`
      <span class="tk-daterange" role="group" aria-label=${col.header}>
        <ion-icon name="calendar-outline"></ion-icon>
        <ion-input type="date" aria-label=${this.t.fromOf.replace("{label}", col.header)} .value=${f3?.from ?? ""} @ionChange=${(e6) => this.onInlineRange(col, "from", e6)}></ion-input>
        <span class="arr">→</span>
        <ion-input type="date" aria-label=${this.t.toOf.replace("{label}", col.header)} .value=${f3?.to ?? ""} @ionChange=${(e6) => this.onInlineRange(col, "to", e6)}></ion-input>
      </span>
    `;
  }
  // Menú overflow («⋮») con ion-popover anclado por evento (Shadow-DOM-safe).
  renderOverflowMenu() {
    if (!this.menuActions.length) return A;
    return b2`
      <ion-button class="toolbtn" fill="clear" aria-label=${this.t.moreActions} @click=${(e6) => this.openMenu(e6)}>
        <ion-icon slot="icon-only" name="ellipsis-vertical"></ion-icon>
      </ion-button>
      <ion-popover
        .isOpen=${this.menuOpen}
        .event=${this.menuEv}
        dismiss-on-select="true"
        @didDismiss=${() => this.menuOpen = false}
      >
        <ion-content>
          <ion-list lines="none">
            ${this.menuActions.map(
      (a3) => b2`
                <ion-item button .detail=${false} @click=${() => {
        this.menuOpen = false;
        this.emit("menuAction", { actionId: a3.id });
      }}>
                  ${a3.icon ? b2`<ion-icon slot="start" name=${a3.icon} color=${a3.color ?? A}></ion-icon>` : A}
                  <ion-label color=${a3.color ?? A}>${a3.label}</ion-label>
                </ion-item>
              `
    )}
          </ion-list>
        </ion-content>
      </ion-popover>
    `;
  }
  // Botones de acción de una fila (compartido por vista tabla y tarjetas).
  actionButtons(row) {
    if (!this.actions.length) return A;
    return b2`
      <div class="actions">
        ${this.actions.map(
      (a3) => b2`
            <ion-button
              size="small"
              fill="clear"
              color=${a3.color ?? "medium"}
              @click=${() => this.emit("rowAction", { actionId: a3.id, row })}
            >
              ${a3.icon ? b2`<ion-icon slot="icon-only" name=${a3.icon}></ion-icon>` : a3.label}
            </ion-button>
          `
    )}
      </div>
    `;
  }
  // Botón de barra icon-only (filtros / alta / conmutador de vista). `on` = estado activo.
  // `badge` opcional → contador (p.ej. nº de filtros activos), look del Hub.
  toolButton(icon, on, onClick, label, badge) {
    return b2`
      <ion-button class="toolbtn" size="small" fill=${on ? "solid" : "outline"} title=${label} aria-label=${label} @click=${onClick}>
        <ion-icon slot="icon-only" name=${icon}></ion-icon>
        ${badge && badge > 0 ? b2`<span class="badge">${badge}</span>` : A}
      </ion-button>
    `;
  }
  /** Plantilla de columnas del grid de la vista lista: [checkbox] [columnas…] [acciones]. */
  gridTemplate() {
    return [
      this.selectable ? "2.75rem" : null,
      ...this.visibleColumns.map((c5) => c5.width ?? "minmax(8rem,1fr)"),
      this.actions.length ? "auto" : null
    ].filter(Boolean).join(" ");
  }
  /** Lista de páginas a mostrar en el pager numerado (1-based): primera, última, vecinas de la
   *  actual y «…» donde haya saltos. P.ej. en página 1 de 52 → [1,2,3,'…',52]. */
  pageList(cur1, total) {
    if (total <= 7) return Array.from({ length: total }, (_2, i8) => i8 + 1);
    const want = /* @__PURE__ */ new Set([1, total, cur1, cur1 - 1, cur1 + 1]);
    if (cur1 <= 3) [2, 3].forEach((p4) => want.add(p4));
    if (cur1 >= total - 2) [total - 1, total - 2].forEach((p4) => want.add(p4));
    const sorted = [...want].filter((p4) => p4 >= 1 && p4 <= total).sort((a3, b3) => a3 - b3);
    const out = [];
    let prev = 0;
    for (const p4 of sorted) {
      if (p4 - prev > 1) out.push("\u2026");
      out.push(p4);
      prev = p4;
    }
    return out;
  }
  render() {
    const ps = this.serverSide ? this.pageSize : this.clientPageSize || this.pageSize;
    let visible;
    let pages;
    let current;
    let count;
    if (this.serverSide) {
      visible = this.rows;
      count = this.total;
      pages = Math.max(1, Math.ceil(this.total / ps));
      current = Math.min(this.page, pages - 1);
    } else {
      const filtered = this.clientFiltered;
      count = filtered.length;
      pages = Math.max(1, Math.ceil(filtered.length / ps));
      current = Math.min(this.clientPage, pages - 1);
      visible = filtered.slice(current * ps, current * ps + ps);
    }
    const goTo = (p4) => {
      if (this.serverSide) this.emit("pageChange", p4);
      else this.clientPage = p4;
    };
    const setPageSize = (n6) => {
      if (this.serverSide) this.emit("pageSizeChange", n6);
      else {
        this.clientPageSize = n6;
        this.clientPage = 0;
      }
    };
    const searchbar = this.serverSide ? b2`<ion-searchbar class="ion-no-border" placeholder=${this.effSearchPlaceholder} debounce="250" @ionInput=${this.onSearch}></ion-searchbar>` : b2`<ion-searchbar class="ion-no-border" .value=${this.q} placeholder=${this.effSearchPlaceholder} debounce="250" @ionInput=${this.onSearch}></ion-searchbar>`;
    const selCount = this.selection.size;
    const showTopbar = !!this.title || this.hasSearch || this.viewToggle || this.effColumnPicker || this.effExport || this.effImport || this.hasFilterRow || this.addable || !!this.primaryAction;
    return b2`
      <div class="card">
        ${showTopbar ? b2`
              <div class="bar">
                <div class="bar-main">
                  ${this.title ? b2`<div class="title-wrap"><h2 class="title">${this.title}</h2><span class="title-count">${count}</span></div>` : A}
                  ${this.hasSearch ? b2`<div class="search">${searchbar}</div>` : A}
                  ${this.inlineFilters ? this.renderInlineFilters() : A}
                  <span class="tk-spacer"></span>
                    ${this.effColumnPicker ? b2`
                          <ion-select
                            class="tk-cols"
                            multiple
                            interface="popover"
                            aria-label=${this.t.columnsVisible}
                            .value=${this.visibleColumns.map((c5) => c5.key)}
                            .selectedText=${this.t.columns}
                            @ionChange=${(e6) => this.setVisibleColumns(e6.detail.value)}
                          >
                            ${this.columns.map((c5) => b2`<ion-select-option value=${c5.key}>${c5.header}</ion-select-option>`)}
                          </ion-select>
                        ` : A}
                    ${this.effPageSizes.length ? b2`
                          <ion-select
                            class="tk-psize"
                            interface="popover"
                            aria-label=${this.t.rowsPerPage}
                            .value=${ps}
                            @ionChange=${(e6) => setPageSize(Number(e6.detail.value))}
                          >
                            ${this.effPageSizes.map((n6) => b2`<ion-select-option .value=${n6}>${n6}</ion-select-option>`)}
                          </ion-select>
                        ` : A}
                    ${this.viewToggle ? b2`
                          <span class="viewseg">
                            ${this.toolButton("list-outline", this.viewMode === "table", () => this.setViewMode("table"), this.t.viewList)}
                            ${this.toolButton("grid-outline", this.viewMode === "cards", () => this.setViewMode("cards"), this.t.viewCards)}
                          </span>
                        ` : A}
                    ${this.hasFilterRow && !this.inlineFilters ? this.toolButton("funnel-outline", this.panel === "filters" || this.activeFilterCount > 0, () => this.toggle("filters"), this.t.filters, this.serverSide ? void 0 : this.activeFilterCount) : A}
                    ${this.effImport ? b2`
                          ${this.toolButton("cloud-upload-outline", false, () => this.renderRoot.querySelector(".tk-file")?.click(), this.t.importCsv)}
                          <input class="tk-file" type="file" accept=".csv,text/csv" hidden @change=${(e6) => this.onImportFile(e6)} />
                        ` : A}
                    ${this.effExport ? this.toolButton("download-outline", false, () => this.exportCsv(), this.t.exportCsv) : A}
                    ${this.addable ? this.toolButton("add", this.panel === "create", () => this.toggle("create"), this.t.add) : A}
                    ${this.renderOverflowMenu()}
                    ${this.primaryAction ? b2`
                          <ion-button
                            class="primary-btn"
                            size="small"
                            title=${this.primaryAction.label}
                            aria-label=${this.primaryAction.label}
                            @click=${() => this.emit("primaryAction", {})}
                          ><ion-icon slot="icon-only" name=${this.primaryAction.icon ?? "add"}></ion-icon></ion-button>
                        ` : A}
                    <!-- El módulo proyecta aquí acciones globales adicionales. -->
                    <slot name="toolbar"></slot>
                </div>
                ${this.selectable && selCount > 0 ? b2`
                      <div class="selbar">
                        <strong>${this.t.selected.replace("{n}", String(selCount))}</strong>
                        <button class="sel-clear" @click=${() => this.setSelection(/* @__PURE__ */ new Set())}>
                          <ion-icon name="close" style="font-size:14px"></ion-icon> ${this.t.clear}
                        </button>
                      </div>
                    ` : A}
              </div>
            ` : A}

        ${this.viewMode === "cards" && this.cardViewEnabled ? this.renderCards(visible) : this.renderTable(visible)}

        ${pages > 1 || this.effPageSizes.length ? b2`
              <div class="pager">
                <div class="left">
                  <span>
                    ${pages > 1 ? b2`${this.t.showing.replace("{from}", String(current * ps + 1)).replace("{to}", String(Math.min((current + 1) * ps, count)))} ` : A}
                    <span class="strong">${count}</span> ${count === 1 ? this.t.recordSingular : this.t.recordPlural}
                  </span>
                  ${!showTopbar && this.effPageSizes.length ? b2`
                        <select class="psize" @change=${(e6) => setPageSize(Number(e6.target.value))}>
                          ${this.effPageSizes.map((n6) => b2`<option value=${n6} ?selected=${n6 === ps}>${this.t.perPageShort.replace("{n}", String(n6))}</option>`)}
                        </select>
                      ` : A}
                </div>
                ${pages > 1 ? b2`
                      <div class="nav">
                        <ion-button size="small" fill="clear" ?disabled=${current === 0} @click=${() => goTo(current - 1)}><ion-icon slot="icon-only" name="chevron-back"></ion-icon></ion-button>
                        ${this.pageList(current + 1, pages).map(
      (p4) => p4 === "\u2026" ? b2`<span class="pgap">…</span>` : b2`<button class=${`pnum${p4 === current + 1 ? " on" : ""}`} @click=${() => goTo(p4 - 1)}>${p4}</button>`
    )}
                        <ion-button size="small" fill="clear" ?disabled=${current >= pages - 1} @click=${() => goTo(current + 1)}><ion-icon slot="icon-only" name="chevron-forward"></ion-icon></ion-button>
                      </div>
                    ` : A}
              </div>
            ` : A}

        ${this.panel !== "none" ? this.renderDrawer() : A}
      </div>
    `;
  }
  // Panel lateral derecho DENTRO de la tabla (no empuja contenido; igual en lista y tarjetas).
  renderDrawer() {
    const isFilters = this.panel === "filters";
    const clientFilters = isFilters && !this.serverSide;
    return b2`
      <div class="tk-scrim" @click=${() => this.close()}></div>
      <aside class="drawer" role="dialog" aria-label=${isFilters ? this.t.filters : this.t.form}>
        <header class="dh">
          <strong>${isFilters ? this.t.filters : this.t.newRecord}</strong>
          <ion-button fill="clear" size="small" aria-label=${this.t.close} @click=${() => this.close()}><ion-icon slot="icon-only" name="close"></ion-icon></ion-button>
        </header>
        <div class="db">
          ${isFilters ? clientFilters ? this.filterColumns.map((c5) => this.renderClientFilter(c5)) : this.filterColumns.map((c5) => b2`<div class="fblock">${this.renderFilterControl(c5)}</div>`) : b2`<slot name="create"></slot>`}
        </div>
        ${clientFilters ? b2`
              <footer class="df">
                <button class="sel-clear df-clear" ?disabled=${Object.keys(this.filterDraft).length === 0} @click=${() => this.clearFilters()}>${this.t.clear}</button>
                <ion-button class="primary-btn" size="small" @click=${() => this.applyFilters()}>${this.t.apply}</ion-button>
              </footer>
            ` : A}
      </aside>
    `;
  }
  // Control de filtro CLIENTE de una columna: chips multi-select (select) o rango de fechas.
  renderClientFilter(col) {
    const label = col.header;
    if (col.filterType === "daterange" || col.filterType === "date") {
      const f3 = this.filterDraft[col.key] ?? {};
      return b2`
        <div class="fblock">
          <span class="flabel">${label}</span>
          <div class="daterange">
            <ion-input type="date" label=${this.t.from} label-placement="stacked" fill="outline" .value=${f3.from ?? ""} @ionChange=${(e6) => this.setFilterRange(col.key, "from", e6.detail.value ?? "")}></ion-input>
            <ion-input type="date" label=${this.t.to} label-placement="stacked" fill="outline" .value=${f3.to ?? ""} @ionChange=${(e6) => this.setFilterRange(col.key, "to", e6.detail.value ?? "")}></ion-input>
          </div>
        </div>
      `;
    }
    const distinct = this.distinctValues(col);
    const selected = this.filterDraft[col.key]?.values ?? /* @__PURE__ */ new Set();
    return b2`
      <div class="fblock">
        <span class="flabel">${label}</span>
        <div class="chips">
          ${distinct.length === 0 ? b2`<span class="chip-empty">${this.t.noValues}</span>` : distinct.map((v3) => {
      const on = selected.has(v3);
      return b2`
                  <button class=${`chip${on ? " on" : ""}`} @click=${() => this.toggleFilterValue(col.key, v3)}>
                    ${on ? b2`<ion-icon name="checkmark-outline"></ion-icon>` : A}${v3}
                  </button>
                `;
    })}
        </div>
      </div>
    `;
  }
  emptyState() {
    return b2`
      <div class="empty">
        <span class="empty-ic"><ion-icon name="file-tray-outline"></ion-icon></span>
        <span>${this.effEmptyMessage}</span>
      </div>
    `;
  }
  // Vista LISTA en CSS GRID (no <table>): permite ancho por columna y cabecera sticky.
  renderTable(visible) {
    if (visible.length === 0) return this.emptyState();
    const cols = this.visibleColumns;
    const tpl = { gridTemplateColumns: this.gridTemplate() };
    const allOn = this.selectable && visible.length > 0 && visible.every((r6) => this.selection.has(this.keyOf(r6)));
    const alignCls = (a3) => a3 === "right" ? "right" : a3 === "center" ? "center" : "left";
    return b2`
      <div class="scroll">
        <div class="grid" role="table">
          <!-- Cabecera -->
          <div class="grow ghead" role="row" style=${o6(tpl)}>
            ${this.selectable ? b2`<span class="selcb"><ion-checkbox .checked=${allOn} aria-label=${this.t.selectAll} @ionChange=${() => this.toggleAll(visible)}></ion-checkbox></span>` : A}
            ${cols.map((c5) => {
      const sortable = this.isSortable(c5);
      const active = sortable && (this.serverSide ? this.sort === c5.key : this.clientSort === c5.key);
      const dir = this.serverSide ? this.sortDir : this.clientSortDir;
      const caretIcon = !active ? "swap-vertical-outline" : dir === "asc" ? "chevron-up-outline" : "chevron-down-outline";
      return b2`
                <div
                  class=${`gcell gh ${alignCls(c5.align)}${sortable ? " sortable" : ""}`}
                  role="columnheader"
                  @click=${() => this.onHeaderClick(c5)}
                >
                  <span>${c5.header}</span>
                  ${sortable ? b2`<span class=${`caret${active ? " on" : ""}`}><ion-icon name=${caretIcon}></ion-icon></span>` : A}
                </div>
              `;
    })}
            ${this.actions.length ? b2`<div class="gcell gh right" role="columnheader">${this.t.actions}</div>` : A}
          </div>

          <!-- Filas -->
          ${c4(
      visible,
      (row) => this.keyOf(row),
      (row) => {
        const key = this.keyOf(row);
        const selected = this.selectable && this.selection.has(key);
        return b2`
                <div class=${`grow grow-data${selected ? " selected" : ""}`} role="row" style=${o6(tpl)}>
                  ${this.selectable ? b2`<span class="selcb"><ion-checkbox .checked=${selected} aria-label=${this.t.selectRow} @ionChange=${() => this.toggleRow(key)}></ion-checkbox></span>` : A}
                  ${cols.map(
          (c5) => b2`<div class=${`gcell ${alignCls(c5.align)}`} role="cell">${c5.render ? c5.render(row) : b2`<span>${this.cell(c5, row)}</span>`}</div>`
        )}
                  ${this.actions.length ? b2`<div class="gcell right" role="cell">${this.actionButtons(row)}</div>` : A}
                </div>
              `;
      }
    )}
        </div>
      </div>
    `;
  }
  renderCards(visible) {
    if (visible.length === 0) return this.emptyState();
    const hasHead = !!this.cardTitle || !!this.cardIcon || this.selectable;
    return b2`
      <div class="cards-grid">
        ${c4(
      visible,
      (row) => this.keyOf(row),
      (row) => {
        const key = this.keyOf(row);
        const selected = this.selectable && this.selection.has(key);
        const icon = this.cardIcon?.(row);
        return b2`
              <div class=${`rcard${selected ? " selected" : ""}`}>
                ${hasHead ? b2`
                      <header class="rcard-head">
                        ${icon != null && icon !== "" ? b2`<span class="rc-icon">${typeof icon === "string" ? b2`<ion-icon name=${icon}></ion-icon>` : icon}</span>` : A}
                        <span class="rc-title">${this.cardTitle ? this.cardTitle(row) : A}</span>
                        ${this.selectable ? b2`<ion-checkbox .checked=${selected} aria-label=${this.t.select} @ionChange=${() => this.toggleRow(key)}></ion-checkbox>` : A}
                      </header>
                    ` : A}
                <div class="rcard-body">
                  ${this.renderCard ? this.renderCard(row) : this.visibleColumns.map(
          (c5) => b2`<div class="rrow"><span class="rk">${c5.header}</span><span class="rv">${c5.render ? c5.render(row) : this.cell(c5, row)}</span></div>`
        )}
                </div>
                ${this.actions.length ? b2`<div class="ractions">${this.actionButtons(row)}</div>` : A}
              </div>
            `;
      }
    )}
      </div>
    `;
  }
};
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "columns");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "rows");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "searchKeys");
__decorateClass2([
  n4({ attribute: "row-key-field" })
], OkDataTable.prototype, "rowKeyField");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "rowKey");
__decorateClass2([
  n4({ type: Number, attribute: "page-size" })
], OkDataTable.prototype, "pageSize");
__decorateClass2([
  n4({ attribute: "empty-message" })
], OkDataTable.prototype, "emptyMessage");
__decorateClass2([
  n4({ attribute: "search-placeholder" })
], OkDataTable.prototype, "searchPlaceholder");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "labels");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "actions");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "addable");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "pageSizeOptions");
__decorateClass2([
  n4({ type: Boolean, reflect: true })
], OkDataTable.prototype, "fill");
__decorateClass2([
  n4({ type: Boolean, attribute: "column-picker" })
], OkDataTable.prototype, "columnPicker");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "csv");
__decorateClass2([
  n4({ attribute: "csv-name" })
], OkDataTable.prototype, "csvName");
__decorateClass2([
  n4({ type: Boolean, attribute: "server-side" })
], OkDataTable.prototype, "serverSide");
__decorateClass2([
  n4({ type: Number })
], OkDataTable.prototype, "total");
__decorateClass2([
  n4({ type: Number })
], OkDataTable.prototype, "page");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "searchable");
__decorateClass2([
  n4({ type: String })
], OkDataTable.prototype, "sort");
__decorateClass2([
  n4({ attribute: "sort-dir" })
], OkDataTable.prototype, "sortDir");
__decorateClass2([
  n4()
], OkDataTable.prototype, "title");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "views");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "exportable");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "importable");
__decorateClass2([
  n4({ type: Boolean, attribute: "column-selector" })
], OkDataTable.prototype, "columnSelector");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "pageSizes");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "selectable");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "selectedKeys");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "primaryAction");
__decorateClass2([
  n4({ type: Boolean })
], OkDataTable.prototype, "inlineFilters");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "menuActions");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "cardTitle");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "cardIcon");
__decorateClass2([
  n4({ attribute: false })
], OkDataTable.prototype, "renderCard");
__decorateClass2([
  r5()
], OkDataTable.prototype, "q");
__decorateClass2([
  r5()
], OkDataTable.prototype, "clientPage");
__decorateClass2([
  r5()
], OkDataTable.prototype, "clientPageSize");
__decorateClass2([
  r5()
], OkDataTable.prototype, "clientSort");
__decorateClass2([
  r5()
], OkDataTable.prototype, "clientSortDir");
__decorateClass2([
  r5()
], OkDataTable.prototype, "clientFilters");
__decorateClass2([
  r5()
], OkDataTable.prototype, "filterDraft");
__decorateClass2([
  r5()
], OkDataTable.prototype, "panel");
__decorateClass2([
  r5()
], OkDataTable.prototype, "viewMode");
__decorateClass2([
  r5()
], OkDataTable.prototype, "hiddenKeys");
__decorateClass2([
  r5()
], OkDataTable.prototype, "internalSelection");
__decorateClass2([
  r5()
], OkDataTable.prototype, "menuOpen");
define("ok-data-table", OkDataTable);

// ../modules-workspace/node_modules/.pnpm/@outfitkit+core@file+..+outfitkit/node_modules/@outfitkit/core/dist/ok-qr.js
var __defProp3 = Object.defineProperty;
var __decorateClass3 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i8 = decorators.length - 1, decorator; i8 >= 0; i8--)
    if (decorator = decorators[i8])
      result = decorator(target, key, result) || result;
  if (result) __defProp3(target, key, result);
  return result;
};
var GF_EXP = new Uint8Array(512);
var GF_LOG = new Uint8Array(256);
(() => {
  let x2 = 1;
  for (let i8 = 0; i8 < 255; i8++) {
    GF_EXP[i8] = x2;
    GF_LOG[x2] = i8;
    x2 <<= 1;
    if (x2 & 256) x2 ^= 285;
  }
  for (let i8 = 255; i8 < 512; i8++) GF_EXP[i8] = GF_EXP[i8 - 255];
})();
function gfMul(a3, b3) {
  if (a3 === 0 || b3 === 0) return 0;
  return GF_EXP[GF_LOG[a3] + GF_LOG[b3]];
}
function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i8 = 0; i8 < degree; i8++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j2 = 0; j2 < poly.length; j2++) {
      next[j2] ^= poly[j2];
      next[j2 + 1] ^= gfMul(poly[j2], GF_EXP[i8]);
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data, degree) {
  const gen = rsGeneratorPoly(degree);
  const res = new Uint8Array(data.length + degree);
  res.set(data);
  for (let i8 = 0; i8 < data.length; i8++) {
    const coef = res[i8];
    if (coef !== 0) {
      for (let j2 = 0; j2 < gen.length; j2++) {
        res[i8 + j2] ^= gfMul(gen[j2], coef);
      }
    }
  }
  return res.slice(data.length);
}
var EC_ORDER = ["L", "M", "Q", "H"];
var TOTAL_CODEWORDS = [
  26,
  44,
  70,
  100,
  134,
  172,
  196,
  242,
  292,
  346,
  404,
  466,
  532,
  581,
  655,
  733,
  815,
  901,
  991,
  1085,
  1156,
  1258,
  1364,
  1474,
  1588,
  1706,
  1828,
  1921,
  2051,
  2185,
  2323,
  2465,
  2611,
  2761,
  2876,
  3034,
  3196,
  3362,
  3532,
  3706
];
var EC_BLOCKS = [
  /* v1 */
  [[7, 1, 19, 0, 0], [10, 1, 16, 0, 0], [13, 1, 13, 0, 0], [17, 1, 9, 0, 0]],
  /* v2 */
  [[10, 1, 34, 0, 0], [16, 1, 28, 0, 0], [22, 1, 22, 0, 0], [28, 1, 16, 0, 0]],
  /* v3 */
  [[15, 1, 55, 0, 0], [26, 1, 44, 0, 0], [18, 2, 17, 0, 0], [22, 2, 13, 0, 0]],
  /* v4 */
  [[20, 1, 80, 0, 0], [18, 2, 32, 0, 0], [26, 2, 24, 0, 0], [16, 4, 9, 0, 0]],
  /* v5 */
  [[26, 1, 108, 0, 0], [24, 2, 43, 0, 0], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]],
  /* v6 */
  [[18, 2, 68, 0, 0], [16, 4, 27, 0, 0], [24, 4, 19, 0, 0], [28, 4, 15, 0, 0]],
  /* v7 */
  [[20, 2, 78, 0, 0], [18, 4, 31, 0, 0], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]],
  /* v8 */
  [[24, 2, 97, 0, 0], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]],
  /* v9 */
  [[30, 2, 116, 0, 0], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]],
  /* v10 */
  [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]],
  /* v11 */
  [[20, 4, 81, 0, 0], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]],
  /* v12 */
  [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]],
  /* v13 */
  [[26, 4, 107, 0, 0], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]],
  /* v14 */
  [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]],
  /* v15 */
  [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13]],
  /* v16 */
  [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]],
  /* v17 */
  [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47], [28, 1, 22, 15, 23], [28, 2, 14, 17, 15]],
  /* v18 */
  [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44], [28, 17, 22, 1, 23], [28, 2, 14, 19, 15]],
  /* v19 */
  [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45], [26, 17, 21, 4, 22], [26, 9, 13, 16, 14]],
  /* v20 */
  [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42], [30, 15, 24, 5, 25], [28, 15, 15, 10, 16]],
  /* v21 */
  [[28, 4, 116, 4, 117], [26, 17, 42, 0, 0], [28, 17, 22, 6, 23], [30, 19, 16, 6, 17]],
  /* v22 */
  [[28, 2, 111, 7, 112], [28, 17, 46, 0, 0], [30, 7, 24, 16, 25], [24, 34, 13, 0, 0]],
  /* v23 */
  [[30, 4, 121, 5, 122], [28, 4, 47, 14, 48], [30, 11, 24, 14, 25], [30, 16, 15, 14, 16]],
  /* v24 */
  [[30, 6, 117, 4, 118], [28, 6, 45, 14, 46], [30, 11, 24, 16, 25], [30, 30, 16, 2, 17]],
  /* v25 */
  [[26, 8, 106, 4, 107], [28, 8, 47, 13, 48], [30, 7, 24, 22, 25], [30, 22, 15, 13, 16]],
  /* v26 */
  [[28, 10, 114, 2, 115], [28, 19, 46, 4, 47], [28, 28, 22, 6, 23], [30, 33, 16, 4, 17]],
  /* v27 */
  [[30, 8, 122, 4, 123], [28, 22, 45, 3, 46], [30, 8, 23, 26, 24], [30, 12, 15, 28, 16]],
  /* v28 */
  [[30, 3, 117, 10, 118], [28, 3, 45, 23, 46], [30, 4, 24, 31, 25], [30, 11, 15, 31, 16]],
  /* v29 */
  [[30, 7, 116, 7, 117], [28, 21, 45, 7, 46], [30, 1, 23, 37, 24], [30, 19, 15, 26, 16]],
  /* v30 */
  [[30, 5, 115, 10, 116], [28, 19, 47, 10, 48], [30, 15, 24, 25, 25], [30, 23, 15, 25, 16]],
  /* v31 */
  [[30, 13, 115, 3, 116], [28, 2, 46, 29, 47], [30, 42, 24, 1, 25], [30, 23, 15, 28, 16]],
  /* v32 */
  [[30, 17, 115, 0, 0], [28, 10, 46, 23, 47], [30, 10, 24, 35, 25], [30, 19, 15, 35, 16]],
  /* v33 */
  [[30, 17, 115, 1, 116], [28, 14, 46, 21, 47], [30, 29, 24, 19, 25], [30, 11, 15, 46, 16]],
  /* v34 */
  [[30, 13, 115, 6, 116], [28, 14, 46, 23, 47], [30, 44, 24, 7, 25], [30, 59, 16, 1, 17]],
  /* v35 */
  [[30, 12, 121, 7, 122], [28, 12, 47, 26, 48], [30, 39, 24, 14, 25], [30, 22, 15, 41, 16]],
  /* v36 */
  [[30, 6, 121, 14, 122], [28, 6, 47, 34, 48], [30, 46, 24, 10, 25], [30, 2, 15, 64, 16]],
  /* v37 */
  [[30, 17, 122, 4, 123], [28, 29, 46, 14, 47], [30, 49, 24, 10, 25], [30, 24, 15, 46, 16]],
  /* v38 */
  [[30, 4, 122, 18, 123], [28, 13, 46, 32, 47], [30, 48, 24, 14, 25], [30, 42, 15, 32, 16]],
  /* v39 */
  [[30, 20, 117, 4, 118], [28, 40, 47, 7, 48], [30, 43, 24, 22, 25], [30, 10, 15, 67, 16]],
  /* v40 */
  [[30, 19, 118, 6, 119], [28, 18, 47, 31, 48], [30, 34, 24, 34, 25], [30, 20, 15, 61, 16]]
];
var ALIGN_POS = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170]
];
var VERSION_INFO = [
  31892,
  34236,
  39577,
  42195,
  48118,
  51042,
  55367,
  58893,
  63784,
  68472,
  70749,
  76311,
  79154,
  84390,
  87683,
  92361,
  96236,
  102084,
  102881,
  110507,
  110734,
  117786,
  119615,
  126325,
  127568,
  133589,
  136944,
  141498,
  145311,
  150283,
  152622,
  158308,
  161089,
  167017
];
var FORMAT_INFO = [
  21522,
  20773,
  24188,
  23371,
  17913,
  16590,
  20375,
  19104,
  30660,
  29427,
  32170,
  30877,
  26159,
  25368,
  27713,
  26998,
  5769,
  5054,
  7399,
  6608,
  1890,
  597,
  3340,
  2107,
  13663,
  12392,
  16177,
  14854,
  9396,
  8579,
  11994,
  11245
];
var EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
var BitBuffer = class {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i8 = length - 1; i8 >= 0; i8--) {
      this.bits.push(value >>> i8 & 1);
    }
  }
  get length() {
    return this.bits.length;
  }
};
function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}
function encodeData(bytes, version, ec) {
  const totalCw = TOTAL_CODEWORDS[version - 1];
  const blocks = EC_BLOCKS[version - 1][EC_ORDER.indexOf(ec)];
  const ecPerBlock = blocks[0];
  const numBlocks = blocks[1] + blocks[3];
  const totalEcCw = ecPerBlock * numBlocks;
  const dataCwCapacity = totalCw - totalEcCw;
  const dataBitCapacity = dataCwCapacity * 8;
  const ccBits = charCountBits(version);
  const buf = new BitBuffer();
  buf.put(4, 4);
  buf.put(bytes.length, ccBits);
  for (const b3 of bytes) buf.put(b3, 8);
  if (buf.length > dataBitCapacity) return null;
  const remaining = dataBitCapacity - buf.length;
  buf.put(0, Math.min(4, remaining));
  while (buf.length % 8 !== 0) buf.bits.push(0);
  const padBytes = [236, 17];
  let pi = 0;
  while (buf.length < dataBitCapacity) {
    buf.put(padBytes[pi], 8);
    pi ^= 1;
  }
  const dataCw = new Uint8Array(dataCwCapacity);
  for (let i8 = 0; i8 < dataCwCapacity; i8++) {
    let byte = 0;
    for (let j2 = 0; j2 < 8; j2++) byte = byte << 1 | buf.bits[i8 * 8 + j2];
    dataCw[i8] = byte;
  }
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  const layout = [];
  for (let g2 = 0; g2 < blocks[1]; g2++) layout.push([blocks[2]]);
  for (let g2 = 0; g2 < blocks[3]; g2++) layout.push([blocks[4]]);
  for (const [dlen] of layout) {
    const dblk = dataCw.slice(offset, offset + dlen);
    offset += dlen;
    dataBlocks.push(dblk);
    ecBlocks.push(rsEncode(dblk, ecPerBlock));
  }
  const result = new Uint8Array(totalCw);
  let ri = 0;
  const maxData = Math.max(...dataBlocks.map((b3) => b3.length));
  for (let i8 = 0; i8 < maxData; i8++) {
    for (const blk of dataBlocks) if (i8 < blk.length) result[ri++] = blk[i8];
  }
  for (let i8 = 0; i8 < ecPerBlock; i8++) {
    for (const blk of ecBlocks) result[ri++] = blk[i8];
  }
  return result;
}
function buildMatrix(codewords, version, ec) {
  const size = version * 4 + 17;
  const m3 = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r6, c5, v3, isReserved = true) => {
    m3[r6][c5] = v3;
    if (isReserved) reserved[r6][c5] = true;
  };
  const placeFinder = (r6, c5) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r6 + dr;
        const cc = c5 + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = dr >= 0 && dr <= 6 && (dc === 0 || dc === 6) || dc >= 0 && dc <= 6 && (dr === 0 || dr === 6);
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(rr, cc, inRing || inCore ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);
  for (let i8 = 8; i8 < size - 8; i8++) {
    const v3 = i8 % 2 === 0 ? 1 : 0;
    set(6, i8, v3);
    set(i8, 6, v3);
  }
  const aps = ALIGN_POS[version - 1];
  for (const r6 of aps) {
    for (const c5 of aps) {
      if (reserved[r6][c5]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(r6 + dr, c5 + dc, ring === 1 ? 0 : 1);
        }
      }
    }
  }
  set(size - 8, 8, 1);
  for (let i8 = 0; i8 < 9; i8++) {
    if (!reserved[8][i8]) reserved[8][i8] = true;
    if (!reserved[i8][8]) reserved[i8][8] = true;
  }
  for (let i8 = 0; i8 < 8; i8++) {
    reserved[8][size - 1 - i8] = true;
    reserved[size - 1 - i8][8] = true;
  }
  reserved[8][8] = true;
  reserved[8][7] = true;
  reserved[7][8] = true;
  if (version >= 7) {
    for (let i8 = 0; i8 < 6; i8++) {
      for (let j2 = 0; j2 < 3; j2++) {
        reserved[i8][size - 11 + j2] = true;
        reserved[size - 11 + j2][i8] = true;
      }
    }
  }
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  const getBit = (idx) => idx < totalBits ? codewords[idx >> 3] >> 7 - (idx & 7) & 1 : 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i8 = 0; i8 < size; i8++) {
      const row = upward ? size - 1 - i8 : i8;
      for (let k2 = 0; k2 < 2; k2++) {
        const c5 = col - k2;
        if (reserved[row][c5] || m3[row][c5] !== null) continue;
        m3[row][c5] = getBit(bitIdx);
        bitIdx++;
      }
    }
    upward = !upward;
  }
  const maskFns = [
    (r6, c5) => (r6 + c5) % 2 === 0,
    (r6) => r6 % 2 === 0,
    (_r, c5) => c5 % 3 === 0,
    (r6, c5) => (r6 + c5) % 3 === 0,
    (r6, c5) => (Math.floor(r6 / 2) + Math.floor(c5 / 3)) % 2 === 0,
    (r6, c5) => r6 * c5 % 2 + r6 * c5 % 3 === 0,
    (r6, c5) => (r6 * c5 % 2 + r6 * c5 % 3) % 2 === 0,
    (r6, c5) => ((r6 + c5) % 2 + r6 * c5 % 3) % 2 === 0
  ];
  let bestPenalty = Infinity;
  let bestMatrix = [];
  for (let mask = 0; mask < 8; mask++) {
    const grid = Array.from({ length: size }, () => new Array(size).fill(false));
    for (let r6 = 0; r6 < size; r6++) {
      for (let c5 = 0; c5 < size; c5++) {
        let v3 = m3[r6][c5] === 1;
        if (!reserved[r6][c5] && maskFns[mask](r6, c5)) v3 = !v3;
        grid[r6][c5] = v3;
      }
    }
    applyFormatAndVersion(grid, reserved, version, ec, mask);
    const penalty = scorePenalty(grid);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = grid;
    }
  }
  return bestMatrix;
}
function applyFormatAndVersion(grid, _reserved, version, ec, mask) {
  const size = grid.length;
  const fmt = FORMAT_INFO[EC_FORMAT_BITS[ec] << 3 | mask];
  for (let i8 = 0; i8 < 15; i8++) {
    const bit = (fmt >> i8 & 1) === 1;
    if (i8 < 6) grid[i8][8] = bit;
    else if (i8 === 6) grid[7][8] = bit;
    else if (i8 === 7) grid[8][8] = bit;
    else if (i8 === 8) grid[8][7] = bit;
    else grid[8][14 - i8] = bit;
    if (i8 < 8) grid[8][size - 1 - i8] = bit;
    else grid[size - 15 + i8][8] = bit;
  }
  grid[size - 8][8] = true;
  if (version >= 7) {
    const vinfo = VERSION_INFO[version - 7];
    for (let i8 = 0; i8 < 18; i8++) {
      const bit = (vinfo >> i8 & 1) === 1;
      const r6 = Math.floor(i8 / 3);
      const c5 = i8 % 3;
      grid[r6][size - 11 + c5] = bit;
      grid[size - 11 + c5][r6] = bit;
    }
  }
}
function scorePenalty(grid) {
  const n6 = grid.length;
  let penalty = 0;
  const lineRun = (get) => {
    let p4 = 0;
    let runColor = get(0);
    let runLen = 1;
    for (let i8 = 1; i8 < n6; i8++) {
      const v3 = get(i8);
      if (v3 === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) p4 += 3 + (runLen - 5);
        runColor = v3;
        runLen = 1;
      }
    }
    if (runLen >= 5) p4 += 3 + (runLen - 5);
    return p4;
  };
  for (let r6 = 0; r6 < n6; r6++) penalty += lineRun((c5) => grid[r6][c5]);
  for (let c5 = 0; c5 < n6; c5++) penalty += lineRun((r6) => grid[r6][c5]);
  for (let r6 = 0; r6 < n6 - 1; r6++) {
    for (let c5 = 0; c5 < n6 - 1; c5++) {
      const v3 = grid[r6][c5];
      if (v3 === grid[r6][c5 + 1] && v3 === grid[r6 + 1][c5] && v3 === grid[r6 + 1][c5 + 1]) penalty += 3;
    }
  }
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matchAt = (get, start) => {
    let a3 = true;
    let b3 = true;
    for (let k22 = 0; k22 < 11; k22++) {
      const v3 = get(start + k22);
      if (v3 !== pat1[k22]) a3 = false;
      if (v3 !== pat2[k22]) b3 = false;
    }
    return a3 || b3;
  };
  for (let r6 = 0; r6 < n6; r6++) {
    for (let c5 = 0; c5 <= n6 - 11; c5++) {
      if (matchAt((i8) => grid[r6][i8], c5)) penalty += 40;
    }
  }
  for (let c5 = 0; c5 < n6; c5++) {
    for (let r6 = 0; r6 <= n6 - 11; r6++) {
      if (matchAt((i8) => grid[i8][c5], r6)) penalty += 40;
    }
  }
  let dark = 0;
  for (let r6 = 0; r6 < n6; r6++) for (let c5 = 0; c5 < n6; c5++) if (grid[r6][c5]) dark++;
  const ratio = dark * 100 / (n6 * n6);
  const k2 = Math.floor(Math.abs(ratio - 50) / 5);
  penalty += k2 * 10;
  return penalty;
}
function generateQr(value, ec) {
  const bytes = new TextEncoder().encode(value);
  for (let version = 1; version <= 40; version++) {
    const codewords = encodeData(bytes, version, ec);
    if (codewords) return buildMatrix(codewords, version, ec);
  }
  return null;
}
var OkQr = class extends i4 {
  constructor() {
    super(...arguments);
    this.value = "";
    this.ec = "M";
    this.size = 160;
    this.color = "";
    this.background = "";
    this.margin = 4;
  }
  static {
    this.styles = i`
    :host {
      /* Tokens overridables (cadena --ok-* → --ion-* → hex). */
      --module-color: var(--ok-text, var(--ion-text-color, #000000));
      --bg-color: var(--ok-surface, transparent);

      /* Inline: ocupa solo lo que necesita su tamaño. */
      display: inline-block;
      line-height: 0;
    }
    svg {
      display: block;
      width: var(--ok-qr-size, 160px);
      height: var(--ok-qr-size, 160px);
    }
    rect.qr-bg {
      fill: var(--bg-color);
    }
    path.qr-fg {
      fill: var(--module-color);
      shape-rendering: crispEdges;
    }
  `;
  }
  render() {
    if (!this.value) return b2``;
    const level = EC_ORDER.includes(this.ec) ? this.ec : "M";
    const matrix = generateQr(this.value, level);
    if (!matrix) return b2``;
    const count = matrix.length;
    const quiet = Math.max(0, Math.floor(this.margin));
    const dim = count + quiet * 2;
    let d3 = "";
    for (let r6 = 0; r6 < count; r6++) {
      for (let c5 = 0; c5 < count; c5++) {
        if (matrix[r6][c5]) {
          d3 += `M${c5 + quiet} ${r6 + quiet}h1v1h-1z`;
        }
      }
    }
    const fg = this.color || void 0;
    const bg = this.background || void 0;
    const fgStyle = fg ? `fill:${fg}` : void 0;
    const bgStyle = bg ? `fill:${bg}` : void 0;
    const body = w`
      <rect class="qr-bg" x="0" y="0" width="${dim}" height="${dim}" style="${bgStyle ?? ""}"></rect>
      <path class="qr-fg" d="${d3}" style="${fgStyle ?? ""}"></path>
    `;
    return b2`
      <svg
        style="width:${this.size}px;height:${this.size}px"
        viewBox="0 0 ${dim} ${dim}"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label=${`C\xF3digo QR: ${this.value}`}
        shape-rendering="crispEdges"
      >
        ${body}
      </svg>
    `;
  }
};
__decorateClass3([
  n4({ type: String })
], OkQr.prototype, "value");
__decorateClass3([
  n4({ type: String })
], OkQr.prototype, "ec");
__decorateClass3([
  n4({ type: Number })
], OkQr.prototype, "size");
__decorateClass3([
  n4({ type: String })
], OkQr.prototype, "color");
__decorateClass3([
  n4({ type: String })
], OkQr.prototype, "background");
__decorateClass3([
  n4({ type: Number })
], OkQr.prototype, "margin");
define("ok-qr", OkQr);

// ../modules-workspace/node_modules/.pnpm/@outfitkit+core@file+..+outfitkit/node_modules/@outfitkit/core/dist/ok-invoice.js
var __defProp4 = Object.defineProperty;
var __decorateClass4 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i8 = decorators.length - 1, decorator; i8 >= 0; i8--)
    if (decorator = decorators[i8])
      result = decorator(target, key, result) || result;
  if (result) __defProp4(target, key, result);
  return result;
};
var DEFAULT_LABELS2 = {
  empty: "No invoice data.",
  invoice: "Invoice",
  number: "No.",
  date: "Date",
  dueDate: "Due date",
  billTo: "Bill to",
  description: "Description",
  qty: "Qty",
  price: "Price",
  discount: "Disc.",
  tax: "Tax",
  amount: "Amount",
  noLines: "\u2014 No lines \u2014",
  taxBase: "Tax base",
  discountTotal: "Discount",
  total: "TOTAL",
  paymentMethod: "Payment method"
};
var OkInvoice = class extends i4 {
  constructor() {
    super(...arguments);
    this.qrSize = 96;
    this.labels = {};
  }
  static {
    this.styles = i`
    :host {
      --ink: var(--ok-text, var(--ion-text-color, #1c1b18));
      --muted: #6b6b6b;
      --rule: #d9d6cf;
      --accent: var(--ok-color-primary, var(--ion-color-primary, #0091ce));
      --soft: color-mix(in srgb, var(--accent) 8%, #fff);
      display: block;
      width: 100%;
    }
    .sheet {
      box-sizing: border-box;
      /* A4: ancho de papel. Overridable vía --invoice-width. */
      width: var(--invoice-width, 210mm);
      max-width: 100%;
      margin: 0 auto;
      padding: 16mm 14mm;
      background: #fff;
      color: var(--ink);
      font-family: var(--ok-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
      font-size: 12px;
      line-height: 1.5;
    }
    /* Cabecera: emisor a la izquierda, bloque "FACTURA" a la derecha. */
    .top { display: flex; justify-content: space-between; gap: 2rem; align-items: flex-start; }
    .issuer-logo { max-height: 18mm; max-width: 55mm; margin-bottom: .5rem; display: block; }
    .issuer-name { font-size: 15px; font-weight: 700; }
    .issuer-meta, .party-meta { color: var(--muted); font-size: 11px; white-space: pre-line; }
    .doc { text-align: right; min-width: 48mm; }
    .doc-title { font-size: 24px; font-weight: 800; letter-spacing: .06em; color: var(--accent); text-transform: uppercase; }
    .doc-type { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    .doc-grid { margin-top: .6rem; display: grid; grid-template-columns: auto auto; gap: .1rem .8rem; justify-content: end; font-size: 11px; }
    .doc-grid .k { color: var(--muted); text-align: right; }
    .doc-grid .v { font-weight: 600; text-align: right; }
    /* Bloque receptor. */
    .bill-to { margin: 9mm 0 6mm; padding: 3mm 4mm; background: var(--soft); border-radius: 8px; }
    .bill-to .label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .bill-to .name { font-weight: 700; font-size: 13px; }
    /* Tabla de líneas. */
    table.lines { width: 100%; border-collapse: collapse; margin-top: 2mm; }
    table.lines thead th {
      font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
      text-align: left; padding: 2mm 2mm; border-bottom: 1.5px solid var(--ink);
    }
    table.lines tbody td { padding: 2mm 2mm; border-bottom: 1px solid var(--rule); vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .desc { width: 42%; }
    /* Resumen de totales (derecha). */
    .summary { display: flex; justify-content: flex-end; margin-top: 4mm; }
    .summary table { border-collapse: collapse; min-width: 70mm; }
    .summary td { padding: 1mm 2mm; }
    .summary td.num { text-align: right; white-space: nowrap; }
    .summary .grand td { font-size: 15px; font-weight: 800; border-top: 1.5px solid var(--ink); padding-top: 2mm; }
    .summary .grand td.num { color: var(--accent); }
    .muted { color: var(--muted); }
    /* Pie: pago, notas, QR. */
    .foot { margin-top: 8mm; display: flex; justify-content: space-between; gap: 2rem; align-items: flex-start; }
    .pay-box { font-size: 11px; }
    .pay-box .h { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 1mm; }
    .qr-note { font-size: 8px; max-width: 36mm; text-align: center; color: var(--muted); word-break: break-word; }
    .legal { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid var(--rule); font-size: 9px; color: var(--muted); white-space: pre-line; text-align: center; }
    .empty { padding: 12mm; text-align: center; color: #999; font-style: italic; }
  `;
  }
  get t() {
    return { ...DEFAULT_LABELS2, ...this.labels };
  }
  cur() {
    return this.invoice?.currency ?? "\u20AC";
  }
  money(n6) {
    return `${Number(n6 ?? 0).toFixed(2)} ${this.cur()}`;
  }
  render() {
    const inv = this.invoice;
    if (!inv) return b2`<div class="sheet empty">${this.t.empty}</div>`;
    return b2`<div class="sheet" part="sheet">
      ${this.renderTop(inv)}
      ${this.renderBillTo(inv)}
      ${this.renderLines(inv)}
      ${this.renderSummary(inv)}
      ${this.renderFoot(inv)}
      ${inv.footer ? b2`<div class="legal">${inv.footer}</div>` : A}
    </div>`;
  }
  party(p4) {
    const loc = [p4.postal_code, p4.city].filter(Boolean).join(" ");
    const lines = [p4.address, loc, p4.country, p4.tax_id, p4.email, p4.phone].filter(Boolean);
    return b2`${lines.map((l3) => b2`<div>${l3}</div>`)}`;
  }
  renderTop(inv) {
    const iss = inv.issuer ?? { name: "" };
    return b2`<div class="top">
      <div>
        ${iss.logo_url ? b2`<img class="issuer-logo" src=${iss.logo_url} alt=${iss.name || "logo"} />` : A}
        <div class="issuer-name">${iss.name}</div>
        <div class="issuer-meta">${this.party(iss)}</div>
      </div>
      <div class="doc">
        <div class="doc-title">${this.t.invoice}</div>
        ${inv.type ? b2`<div class="doc-type">${inv.type}</div>` : A}
        <div class="doc-grid">
          <span class="k">${this.t.number}</span><span class="v">${inv.number}</span>
          <span class="k">${this.t.date}</span><span class="v">${inv.issue_date}</span>
          ${inv.due_date ? b2`<span class="k">${this.t.dueDate}</span><span class="v">${inv.due_date}</span>` : A}
        </div>
      </div>
    </div>`;
  }
  renderBillTo(inv) {
    const c5 = inv.customer;
    if (!c5) return A;
    return b2`<div class="bill-to">
      <div class="label">${this.t.billTo}</div>
      <div class="name">${c5.name}</div>
      <div class="party-meta">${this.party(c5)}</div>
    </div>`;
  }
  renderLines(inv) {
    const lines = inv.lines ?? [];
    const hasDisc = lines.some((l3) => l3.discount_percent);
    const hasTax = lines.some((l3) => l3.tax_rate != null);
    return b2`<table class="lines">
      <thead>
        <tr>
          <th class="desc">${this.t.description}</th>
          <th class="num">${this.t.qty}</th>
          <th class="num">${this.t.price}</th>
          ${hasDisc ? b2`<th class="num">${this.t.discount}</th>` : A}
          ${hasTax ? b2`<th class="num">${this.t.tax}</th>` : A}
          <th class="num">${this.t.amount}</th>
        </tr>
      </thead>
      <tbody>
        ${lines.length ? lines.map(
      (l3) => b2`<tr>
                <td class="desc">${l3.description}</td>
                <td class="num">${l3.qty}</td>
                <td class="num">${this.money(l3.unit_price)}</td>
                ${hasDisc ? b2`<td class="num">${l3.discount_percent ? `${l3.discount_percent}%` : "\u2014"}</td>` : A}
                ${hasTax ? b2`<td class="num">${l3.tax_rate != null ? `${l3.tax_rate}%` : "\u2014"}</td>` : A}
                <td class="num">${this.money(l3.total)}</td>
              </tr>`
    ) : b2`<tr><td colspan="6" class="muted" style="text-align:center;padding:6mm">${this.t.noLines}</td></tr>`}
      </tbody>
    </table>`;
  }
  renderSummary(inv) {
    const taxes = inv.taxes ?? [];
    return b2`<div class="summary">
      <table>
        <tr><td class="muted">${this.t.taxBase}</td><td class="num">${this.money(inv.subtotal)}</td></tr>
        ${inv.discount_total ? b2`<tr><td class="muted">${this.t.discountTotal}</td><td class="num">−${this.money(inv.discount_total)}</td></tr>` : A}
        ${taxes.map(
      (t5) => b2`<tr><td class="muted">${t5.label}${t5.base != null ? b2` <span class="muted">(${this.money(t5.base)})</span>` : A}</td><td class="num">${this.money(t5.amount)}</td></tr>`
    )}
        <tr class="grand"><td>${this.t.total}</td><td class="num">${this.money(inv.total)}</td></tr>
      </table>
    </div>`;
  }
  renderFoot(inv) {
    const hasPay = inv.payment_method || inv.payment_terms || inv.notes;
    if (!hasPay && !inv.qr) return A;
    return b2`<div class="foot">
      <div class="pay-box">
        ${inv.payment_method ? b2`<div class="h">${this.t.paymentMethod}</div><div>${inv.payment_method}</div>` : A}
        ${inv.payment_terms ? b2`<div style="margin-top:2mm" class="muted">${inv.payment_terms}</div>` : A}
        ${inv.notes ? b2`<div style="margin-top:3mm">${inv.notes}</div>` : A}
      </div>
      ${inv.qr ? b2`<div class="qr-wrap">
            <ok-qr .value=${inv.qr} .size=${this.qrSize} ec="M"></ok-qr>
            ${inv.qr_note ? b2`<div class="qr-note">${inv.qr_note}</div>` : A}
          </div>` : A}
    </div>`;
  }
};
__decorateClass4([
  n4({ attribute: false })
], OkInvoice.prototype, "invoice");
__decorateClass4([
  n4({ type: Number, attribute: "qr-size" })
], OkInvoice.prototype, "qrSize");
__decorateClass4([
  n4({ attribute: false })
], OkInvoice.prototype, "labels");
define("ok-invoice", OkInvoice);

// ../modules-workspace/node_modules/.pnpm/@erplora+module-sdk@file+..+hub+packages+module-sdk/node_modules/@erplora/module-sdk/src/index.ts
function isEmpty(v3) {
  return v3 === null || v3 === void 0 || v3 === "";
}
var ListController = class {
  constructor(client, queryName, onChange = () => {
  }, opts = {}) {
    this.client = client;
    this.queryName = queryName;
    this.onChange = onChange;
    this.rows = [];
    this.total = 0;
    this.loading = false;
    this.error = "";
    /** Descarta respuestas obsoletas si llegan fuera de orden (race de cargas concurrentes). */
    this.seq = 0;
    this.state = {
      page: 0,
      pageSize: opts.pageSize ?? 50,
      search: "",
      sort: opts.sort,
      dir: opts.dir ?? "asc",
      filters: { ...opts.filters ?? {} },
      context: { ...opts.context ?? {} }
    };
  }
  /** Nº de páginas según el total del servidor (mínimo 1). */
  get pageCount() {
    return Math.max(1, Math.ceil(this.total / this.state.pageSize));
  }
  /** (Re)carga la página actual desde el servidor. */
  async load() {
    const s5 = this.state;
    const mySeq = ++this.seq;
    this.loading = true;
    this.error = "";
    this.onChange();
    try {
      const page = await this.client.queryPage(this.queryName, {
        limit: s5.pageSize,
        offset: s5.page * s5.pageSize,
        search: s5.search,
        sort: s5.sort,
        dir: s5.dir,
        filters: s5.filters,
        params: s5.context
      });
      if (mySeq !== this.seq) return;
      this.rows = page.rows ?? [];
      this.total = page.total ?? this.rows.length;
    } catch (e6) {
      if (mySeq !== this.seq) return;
      this.rows = [];
      this.total = 0;
      this.error = e6 instanceof Error ? e6.message : "Error cargando datos";
    } finally {
      if (mySeq === this.seq) {
        this.loading = false;
        this.onChange();
      }
    }
  }
  setPage(page) {
    this.state.page = Math.max(0, page);
    void this.load();
  }
  setSort(sort, dir) {
    this.state.sort = sort;
    this.state.dir = dir;
    this.state.page = 0;
    void this.load();
  }
  setSearch(search) {
    this.state.search = search;
    this.state.page = 0;
    void this.load();
  }
  /** Cambia el nº de filas por página y recarga desde la página 0. */
  setPageSize(pageSize) {
    this.state.pageSize = Math.max(1, pageSize);
    this.state.page = 0;
    void this.load();
  }
  /** Aplica/quita un filtro de columna; valores vacíos lo eliminan. Vuelve a la página 0. */
  setFilter(col, value) {
    if (isEmpty(value)) {
      delete this.state.filters[col];
    } else if (typeof value === "object" && value !== null) {
      const prev = this.state.filters[col] ?? {};
      const merged = { ...prev, ...value };
      const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v3]) => !isEmpty(v3)));
      if (Object.keys(cleaned).length === 0) delete this.state.filters[col];
      else this.state.filters[col] = cleaned;
    } else {
      this.state.filters[col] = value;
    }
    this.state.page = 0;
    void this.load();
  }
  /** Fija/actualiza los params de contexto obligatorios (p.ej. al seleccionar el padre).
   *  Vuelve a la página 0 y recarga. Pasa `{}` o keys con valor vacío para limpiar. */
  setContext(context) {
    this.state.context = { ...context };
    this.state.page = 0;
    void this.load();
  }
  reset() {
    this.state.page = 0;
    this.state.search = "";
    this.state.filters = {};
    void this.load();
  }
};
function createListController(client, queryName, onChange = () => {
}, opts = {}) {
  return new ListController(client, queryName, onChange, opts);
}

// ../modules-workspace/modules/invoice/locales/es.json
var es_default = {
  name: "Facturaci\xF3n",
  navigation: {
    invoice: {
      label: "Facturas"
    },
    settings: {
      label: "Ajustes"
    }
  },
  ui: {
    pageTitle: "Facturas",
    newInvoice: "Nueva factura",
    close: "Cerrar",
    back: "Volver",
    cancel: "Cancelar",
    loading: "Cargando\u2026",
    empty: "A\xFAn no hay facturas.",
    searchPlaceholder: "Buscar n\xFAmero, cliente o estado\u2026",
    colNumber: "N\xFAmero",
    colType: "Tipo",
    colDate: "Fecha",
    colCustomer: "Cliente",
    colStatus: "Estado",
    colTotal: "Total",
    actionView: "Ver",
    actionMarkPaid: "Marcar pagada",
    actionRectify: "Devoluci\xF3n",
    actionPrint: "Imprimir / PDF",
    aeatTitle: "Justificante VeriFactu",
    aeatCsv: "CSV de la AEAT",
    aeatValidateLink: "Validar en la Agencia Tributaria \u2197",
    aeatNoRecord: "A\xFAn no enviada a la AEAT.",
    aeatAccepted: "Aceptada por la AEAT",
    aeatPending: "Pendiente de env\xEDo",
    aeatRejected: "Rechazada por la AEAT",
    aeatErrorStatus: "Error de env\xEDo",
    qrValidateNote: "Escanea para validar la factura en la AEAT",
    typeInvoice: "Factura",
    typeTicket: "Ticket",
    typeRectifying: "Rectificativa",
    statusDraft: "Borrador",
    statusIssued: "Emitida",
    statusPaid: "Pagada",
    statusCancelled: "Cancelada",
    detailTitle: "Factura {number}",
    fieldType: "Tipo",
    fieldSeries: "Serie",
    fieldIssueDate: "Fecha de emisi\xF3n",
    fieldCustomer: "Cliente",
    fieldCustomerTaxId: "NIF cliente",
    fieldAddress: "Direcci\xF3n",
    fieldIssuer: "Emisor",
    fieldSource: "Origen",
    fieldRectifies: "Rectifica a",
    fieldPaidAt: "Pagada el",
    fieldNotes: "Notas",
    lineDescription: "Descripci\xF3n",
    lineQty: "Cant.",
    linePrice: "Precio",
    lineTaxPct: "IVA %",
    lineBase: "Base",
    lineTax: "Impuesto",
    lineTotal: "Total",
    noLines: "Sin l\xEDneas de detalle.",
    totalBase: "Base",
    totalTaxes: "Impuestos",
    totalTotal: "Total",
    rectifyTitle: "Rectificar {number}",
    rectifyNote: "Se emitir\xE1 una rectificativa R1 (serie RECT) con los importes negados y la factura original quedar\xE1 cancelada. Esta operaci\xF3n no se puede deshacer.",
    lblReason: "Motivo",
    rectifyReasonPlaceholder: "Motivo de la rectificaci\xF3n",
    rectifying: "Rectificando\u2026",
    issueRectifying: "Emitir rectificativa",
    createTitle: "Nueva factura manual",
    placeholderTaxId: "NIF",
    addLine: "+ L\xEDnea",
    issuing: "Emitiendo\u2026",
    issueInvoice: "Emitir factura",
    errNotFound: "Factura no encontrada",
    errLoadDetail: "No se pudo cargar el detalle",
    errMarkPaidStatus: "Solo se puede marcar como pagada una factura emitida.",
    errMarkPaid: "No se pudo marcar como pagada",
    errRectifyRectifying: "Una rectificativa no se puede rectificar.",
    errAlreadyCancelled: "La factura ya est\xE1 cancelada.",
    errRectify: "No se pudo rectificar",
    errCreate: "No se pudo crear la factura",
    seriesTitle: "Series de numeraci\xF3n",
    seriesIntro: "Cada serie define el prefijo y el contador de la numeraci\xF3n de facturas (PREFIX-YYYY-NNNNNN) por tipo de factura (F1, F2, \u2026). El c\xF3digo, el a\xF1o y el contador son inmutables por integridad fiscal; solo se pueden editar el nombre, el prefijo, si est\xE1 activa y si es la predeterminada.",
    newSeries: "Nueva serie",
    seriesColCode: "C\xF3digo",
    seriesColName: "Nombre",
    seriesColType: "Tipo",
    seriesColYear: "A\xF1o",
    seriesColNumber: "N\xBA actual",
    seriesColPrefix: "Prefijo",
    seriesColActive: "Activa",
    seriesColDefault: "Predet.",
    seriesEmpty: "A\xFAn no hay series. Crea la primera para numerar tus facturas.",
    seriesLoading: "Cargando series\u2026",
    seriesSearchPlaceholder: "Buscar c\xF3digo, nombre\u2026",
    seriesActionEdit: "Editar",
    seriesCreateTitle: "Nueva serie de numeraci\xF3n",
    seriesEditTitle: "Editar serie {code}",
    fieldCode: "C\xF3digo",
    fieldName: "Nombre",
    fieldInvoiceType: "Tipo de factura",
    fieldYear: "A\xF1o",
    fieldPrefix: "Prefijo",
    fieldActive: "Activa",
    fieldDefault: "Serie predeterminada",
    codeHint: "Identificador interno de la serie (inmutable tras crearla).",
    prefixHint: "Texto opcional antepuesto al n\xFAmero (ej. FAC \u2192 FAC-2026-000001).",
    yes: "S\xED",
    no: "No",
    save: "Guardar",
    saving: "Guardando\u2026",
    create: "Crear serie",
    creating: "Creando\u2026",
    errSeriesLoad: "No se pudieron cargar las series",
    errSeriesCreate: "No se pudo crear la serie",
    errSeriesUpdate: "No se pudo actualizar la serie",
    errSeriesCodeRequired: "El c\xF3digo es obligatorio.",
    settingsIntro: "Gestiona aqu\xED la numeraci\xF3n de las facturas mediante series."
  }
};

// ../modules-workspace/modules/invoice/locales/en.json
var en_default = {
  name: "Invoicing",
  navigation: {
    invoice: {
      label: "Invoices"
    },
    settings: {
      label: "Settings"
    }
  },
  ui: {
    pageTitle: "Invoices",
    newInvoice: "New invoice",
    close: "Close",
    back: "Back",
    cancel: "Cancel",
    loading: "Loading\u2026",
    empty: "No invoices yet.",
    searchPlaceholder: "Search number, customer or status\u2026",
    colNumber: "Number",
    colType: "Type",
    colDate: "Date",
    colCustomer: "Customer",
    colStatus: "Status",
    colTotal: "Total",
    actionView: "View",
    actionMarkPaid: "Mark as paid",
    actionRectify: "Refund",
    actionPrint: "Print / PDF",
    aeatTitle: "VeriFactu receipt",
    aeatCsv: "AEAT CSV",
    aeatValidateLink: "Verify at the tax agency \u2197",
    aeatNoRecord: "Not sent to the AEAT yet.",
    aeatAccepted: "Accepted by the AEAT",
    aeatPending: "Pending submission",
    aeatRejected: "Rejected by the AEAT",
    aeatErrorStatus: "Submission error",
    qrValidateNote: "Scan to validate the invoice at the AEAT",
    typeInvoice: "Invoice",
    typeTicket: "Receipt",
    typeRectifying: "Corrective",
    statusDraft: "Draft",
    statusIssued: "Issued",
    statusPaid: "Paid",
    statusCancelled: "Cancelled",
    detailTitle: "Invoice {number}",
    fieldType: "Type",
    fieldSeries: "Series",
    fieldIssueDate: "Issue date",
    fieldCustomer: "Customer",
    fieldCustomerTaxId: "Customer tax ID",
    fieldAddress: "Address",
    fieldIssuer: "Issuer",
    fieldSource: "Source",
    fieldRectifies: "Rectifies",
    fieldPaidAt: "Paid on",
    fieldNotes: "Notes",
    lineDescription: "Description",
    lineQty: "Qty",
    linePrice: "Price",
    lineTaxPct: "Tax %",
    lineBase: "Base",
    lineTax: "Tax",
    lineTotal: "Total",
    noLines: "No line items.",
    totalBase: "Base",
    totalTaxes: "Taxes",
    totalTotal: "Total",
    rectifyTitle: "Rectify {number}",
    rectifyNote: "An R1 corrective invoice (RECT series) with negated amounts will be issued and the original invoice will be cancelled. This operation cannot be undone.",
    lblReason: "Reason",
    rectifyReasonPlaceholder: "Reason for the correction",
    rectifying: "Rectifying\u2026",
    issueRectifying: "Issue corrective",
    createTitle: "New manual invoice",
    placeholderTaxId: "Tax ID",
    addLine: "+ Line",
    issuing: "Issuing\u2026",
    issueInvoice: "Issue invoice",
    errNotFound: "Invoice not found",
    errLoadDetail: "Could not load the detail",
    errMarkPaidStatus: "Only an issued invoice can be marked as paid.",
    errMarkPaid: "Could not mark as paid",
    errRectifyRectifying: "A corrective invoice cannot be rectified.",
    errAlreadyCancelled: "The invoice is already cancelled.",
    errRectify: "Could not rectify",
    errCreate: "Could not create the invoice",
    seriesTitle: "Numbering series",
    seriesIntro: "Each series defines the prefix and counter of the invoice numbering (PREFIX-YYYY-NNNNNN) per invoice type (F1, F2, \u2026). The code, year and counter are immutable for fiscal integrity; only the name, prefix, active state and default flag can be edited.",
    newSeries: "New series",
    seriesColCode: "Code",
    seriesColName: "Name",
    seriesColType: "Type",
    seriesColYear: "Year",
    seriesColNumber: "Current no.",
    seriesColPrefix: "Prefix",
    seriesColActive: "Active",
    seriesColDefault: "Default",
    seriesEmpty: "No series yet. Create the first one to number your invoices.",
    seriesLoading: "Loading series\u2026",
    seriesSearchPlaceholder: "Search code, name\u2026",
    seriesActionEdit: "Edit",
    seriesCreateTitle: "New numbering series",
    seriesEditTitle: "Edit series {code}",
    fieldCode: "Code",
    fieldName: "Name",
    fieldInvoiceType: "Invoice type",
    fieldYear: "Year",
    fieldPrefix: "Prefix",
    fieldActive: "Active",
    fieldDefault: "Default series",
    codeHint: "Internal identifier of the series (immutable once created).",
    prefixHint: "Optional text prepended to the number (e.g. FAC \u2192 FAC-2026-000001).",
    yes: "Yes",
    no: "No",
    save: "Save",
    saving: "Saving\u2026",
    create: "Create series",
    creating: "Creating\u2026",
    errSeriesLoad: "Could not load the series",
    errSeriesCreate: "Could not create the series",
    errSeriesUpdate: "Could not update the series",
    errSeriesCodeRequired: "The code is required.",
    settingsIntro: "Manage invoice numbering here through series."
  }
};

// ../modules-workspace/modules/invoice/ui/components/erp-invoice-list/erp-invoice-list.ts
var CATALOG = { es: es_default, en: en_default };
function erplora() {
  const c5 = globalThis.erplora;
  if (!c5) throw new Error("erplora SDK no inicializado por el shell");
  return c5;
}
function erploraT(key, params) {
  return erplora().t(CATALOG, key, params);
}
function typeLabel(code) {
  const map = {
    F1: erploraT("ui.typeInvoice"),
    F2: erploraT("ui.typeTicket"),
    F3: erploraT("ui.typeInvoice"),
    R1: erploraT("ui.typeRectifying"),
    R2: erploraT("ui.typeRectifying"),
    R3: erploraT("ui.typeRectifying"),
    R4: erploraT("ui.typeRectifying"),
    R5: erploraT("ui.typeRectifying")
  };
  return map[code] ?? code;
}
function statusLabel(code) {
  const map = {
    draft: erploraT("ui.statusDraft"),
    issued: erploraT("ui.statusIssued"),
    paid: erploraT("ui.statusPaid"),
    cancelled: erploraT("ui.statusCancelled")
  };
  return map[code] ?? code;
}
var TYPE_CODES = ["F1", "F2", "F3", "R1", "R2", "R3", "R4", "R5"];
var STATUS_CODES = ["draft", "issued", "paid", "cancelled"];
var STATUS_COLOR = {
  draft: "medium",
  issued: "primary",
  paid: "success",
  cancelled: "danger"
};
var fmtMoney = (v3) => erplora().formatAmount(Number(v3 || 0));
var fmtDoc = (v3, currency) => erplora().formatAmount(Number(v3 || 0), { currency });
var num = (v3) => Number(v3 || 0).toFixed(2);
var emptyItem = () => ({ description: "", quantity: "1", unit_price: "", tax_rate: "21" });
var ErpInvoiceList = class extends i4 {
  constructor() {
    super(...arguments);
    this.tick = 0;
    this.detail = null;
    this.detailLines = [];
    this.detailError = "";
    this.aeat = null;
    this.showCreate = false;
    this.saving = false;
    this.formError = "";
    this.newCustomerName = "";
    this.newCustomerTaxId = "";
    this.newCustomerAddress = "";
    this.newNotes = "";
    this.newSeriesCode = "FACT";
    this.newItems = [emptyItem()];
    this.seriesOptions = [];
    this.rectifyTarget = null;
    this.rectifyReason = "";
    this.actionError = "";
    this.busy = false;
    this.canAdd = true;
    this.canRectify = true;
    // Re-render al cambiar el idioma del shell (ADR-0055): los getters `columns`/`rowActions` y el
    // texto del template se re-evalúan con el nuevo `erplora.locale`.
    this.onLocaleChange = () => this.requestUpdate();
  }
  static {
    this.styles = i`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .err { color:#d9480f; font-weight:600; }
    .card { border:1px solid var(--ion-border-color,#e7e2d6); border-radius:10px; padding:1rem; margin-bottom:1rem; background:var(--ion-card-background,#fffdf7); }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap:.35rem .75rem; margin:.5rem 0; }
    .grid dt { font-size:.72rem; text-transform:uppercase; letter-spacing:.03em; color:var(--ion-color-medium,#8a8577); margin:0; }
    .grid dd { margin:0 0 .4rem; font-weight:500; word-break:break-word; }
    table.lines { width:100%; border-collapse:collapse; margin-top:.5rem; font-size:.9rem; }
    table.lines th, table.lines td { padding:.35rem .5rem; border-bottom:1px solid var(--ion-border-color,#e7e2d6); text-align:left; }
    table.lines th:nth-child(n+3), table.lines td:nth-child(n+3) { text-align:right; }
    .totals { display:flex; gap:1.5rem; justify-content:flex-end; margin-top:.6rem; font-weight:600; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input, .form ion-select, .form ion-textarea { flex:1 1 11rem; min-width:9rem; }
    .form ion-textarea { flex:2 1 20rem; min-width:16rem; }
    .item-row { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0; }
    .item-row .desc { flex:2 1 20rem; min-width:16rem; }
    .item-row .num { flex:1 1 6.5rem; min-width:6.5rem; }
    .row-actions { display:flex; gap:.5rem; margin-top:.6rem; }
    .muted { color: var(--ion-color-medium,#8a8577); }
    .kv { display:flex; gap:.5rem; align-items:baseline; margin:.25rem 0; }
    .kv .k { font-size:.72rem; text-transform:uppercase; letter-spacing:.03em; color:var(--ion-color-medium,#8a8577); }
    .kv code { font-family: ui-monospace, monospace; font-size:.85rem; word-break:break-all; }
    .link { color: var(--ion-color-primary,#3880ff); font-weight:600; text-decoration:none; }
    .aeat-card .aeat-head { display:flex; gap:.5rem; align-items:center; }
    .aeat-card .aeat-head h3 { margin:0; flex:1; }
    .qr-wrap { display:flex; flex-direction:column; align-items:center; gap:.4rem; padding:.5rem 0; }
    .qr-note { font-size:.72rem; color:var(--ion-color-medium,#8a8577); text-align:center; }
    /* Documento imprimible: oculto en pantalla, único visible al imprimir / Guardar como PDF. */
    .print-only { display:none; }
    @media print {
      .screen-only { display:none !important; }
      .print-only { display:block !important; }
    }
  `;
  }
  // Getter (no campo): se re-evalúa en cada render, así los textos cambian con el idioma activo
  // (ADR-0055). `connectedCallback` re-renderiza al recibir `erplora:locale-changed`.
  get columns() {
    const t5 = (k2) => erploraT(k2);
    return [
      { key: "number", header: t5("ui.colNumber"), sortable: true, filterable: true, filterType: "text" },
      {
        key: "invoice_type",
        header: t5("ui.colType"),
        sortable: true,
        filterable: true,
        filterType: "select",
        options: TYPE_CODES.map((value) => ({ value, label: typeLabel(value) })),
        format: (r6) => typeLabel(r6.invoice_type)
      },
      { key: "issue_date", header: t5("ui.colDate"), sortable: true, filterable: true, filterType: "daterange" },
      { key: "customer_name", header: t5("ui.colCustomer"), sortable: true, filterable: true, filterType: "text", format: (r6) => r6.customer_name || "\u2014" },
      {
        key: "status",
        header: t5("ui.colStatus"),
        sortable: true,
        filterable: true,
        filterType: "select",
        options: STATUS_CODES.map((value) => ({ value, label: statusLabel(value) })),
        render: (r6) => b2`<ion-badge color=${STATUS_COLOR[r6.status] ?? "medium"}>${statusLabel(r6.status)}</ion-badge>`
      },
      { key: "total_amount", header: t5("ui.colTotal"), align: "right", sortable: true, filterable: true, filterType: "range", format: (r6) => fmtMoney(r6.total_amount) }
    ];
  }
  get rowActions() {
    const acts = [{ id: "view", label: erploraT("ui.actionView"), icon: "eye-outline" }];
    if (this.canAdd) acts.push({ id: "paid", label: erploraT("ui.actionMarkPaid"), icon: "checkmark-circle-outline", color: "success" });
    if (this.canRectify) acts.push({ id: "rectify", label: erploraT("ui.actionRectify"), icon: "arrow-undo-outline", color: "danger" });
    return acts;
  }
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("erplora:locale-changed", this.onLocaleChange);
    try {
      const c5 = erplora();
      this.canAdd = c5.hasPermission?.("invoice.add_invoice") ?? true;
      this.canRectify = c5.hasPermission?.("invoice.rectify_invoice") ?? true;
    } catch {
    }
    this.ctrl = createListController(erplora(), "invoice.list", () => this.requestUpdate(), {
      pageSize: 50,
      sort: "id",
      dir: "asc"
    });
    await this.ctrl.load();
    try {
      const a3 = erplora().on("invoice.created", () => this.ctrl.load());
      const b3 = erplora().on("invoice.rectified", () => this.ctrl.load());
      this.unsub = () => {
        a3();
        b3();
      };
    } catch {
    }
  }
  disconnectedCallback() {
    window.removeEventListener("erplora:locale-changed", this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
  }
  // ── detalle (invoice.get + invoice.lines) ─────────────────────────────────
  async openDetail(id) {
    this.detailError = "";
    try {
      const [inv, lines] = await Promise.all([
        erplora().query("invoice.get", { invoice_id: id }),
        erplora().query("invoice.lines", { invoice_id: id })
      ]);
      const row = Array.isArray(inv) ? inv[0] : inv;
      if (!row) {
        this.detailError = erploraT("ui.errNotFound");
        return;
      }
      this.detail = row;
      this.detailLines = Array.isArray(lines) ? lines : [];
      this.aeat = await this.loadAeat(id);
    } catch (e6) {
      this.detailError = e6 instanceof Error ? e6.message : erploraT("ui.errLoadDetail");
    }
  }
  /** Carga el registro VeriFactu de la factura (qr_url + CSV + estado). Tolerante a fallos. */
  async loadAeat(invoiceId) {
    try {
      const rows = await erplora().query(
        "verifactu.records.by_invoice",
        { invoice_id: invoiceId }
      );
      const rec = Array.isArray(rows) ? rows[0] : rows;
      if (!rec) return null;
      return {
        status: rec.status || "",
        csv: rec.aeat_csv || "",
        qr: rec.qr_url || "",
        record_type: rec.record_type || ""
      };
    } catch {
      return null;
    }
  }
  closeDetail() {
    this.detail = null;
    this.detailLines = [];
    this.detailError = "";
    this.rectifyTarget = null;
    this.aeat = null;
  }
  // ── acciones (mark_paid / rectify) ────────────────────────────────────────
  async markPaid(inv) {
    if (inv.status !== "issued") {
      this.actionError = erploraT("ui.errMarkPaidStatus");
      return;
    }
    this.actionError = "";
    this.busy = true;
    try {
      await erplora().command("invoice.mark_paid", { invoice_id: inv.id });
      await this.ctrl.load();
      if (this.detail?.id === inv.id) await this.openDetail(inv.id);
    } catch (e6) {
      this.actionError = e6 instanceof Error ? e6.message : erploraT("ui.errMarkPaid");
    } finally {
      this.busy = false;
    }
  }
  startRectify(inv) {
    if (inv.invoice_type?.startsWith("R")) {
      this.actionError = erploraT("ui.errRectifyRectifying");
      return;
    }
    if (inv.status === "cancelled") {
      this.actionError = erploraT("ui.errAlreadyCancelled");
      return;
    }
    this.actionError = "";
    this.rectifyReason = "";
    this.rectifyTarget = inv;
  }
  async confirmRectify() {
    const target = this.rectifyTarget;
    if (!target || !this.rectifyReason.trim()) return;
    this.busy = true;
    this.actionError = "";
    try {
      const now = /* @__PURE__ */ new Date();
      await erplora().command("invoice.rectify", {
        original_id: target.id,
        reason: this.rectifyReason.trim(),
        year: now.getFullYear(),
        issue_date: now.toISOString().slice(0, 10)
      });
      this.rectifyTarget = null;
      await this.ctrl.load();
      if (this.detail?.id === target.id) await this.openDetail(target.id);
    } catch (e6) {
      this.actionError = e6 instanceof Error ? e6.message : erploraT("ui.errRectify");
    } finally {
      this.busy = false;
    }
  }
  onRowAction(ev) {
    const inv = ev.detail.row;
    if (ev.detail.actionId === "view") this.openDetail(inv.id);
    else if (ev.detail.actionId === "paid") this.markPaid(inv);
    else if (ev.detail.actionId === "rectify") this.startRectify(inv);
  }
  // ── alta manual (invoice.create) ──────────────────────────────────────────
  async toggleCreate() {
    this.showCreate = !this.showCreate;
    this.formError = "";
    if (this.showCreate && !this.seriesOptions.length) {
      try {
        const rows = await erplora().query("invoice.series.list", {});
        this.seriesOptions = (Array.isArray(rows) ? rows : []).filter((sr) => sr.is_active);
      } catch {
      }
    }
  }
  setItem(i8, key, value) {
    this.newItems = this.newItems.map((it, j2) => j2 === i8 ? { ...it, [key]: value } : it);
  }
  get itemsValid() {
    return this.newItems.length > 0 && this.newItems.every(
      (it) => it.description.trim() && Number(it.quantity) > 0 && it.unit_price !== "" && !Number.isNaN(Number(it.unit_price))
    );
  }
  async create(ev) {
    ev.preventDefault();
    if (!this.itemsValid) return;
    this.saving = true;
    this.formError = "";
    try {
      await erplora().command("invoice.create", {
        series_code: this.newSeriesCode || "FACT",
        customer_name: this.newCustomerName.trim(),
        customer_tax_id: this.newCustomerTaxId.trim(),
        customer_address: this.newCustomerAddress.trim(),
        notes: this.newNotes.trim(),
        source_type: "manual",
        items: this.newItems.map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
          tax_rate: Number(it.tax_rate) || 0,
          product_id: null
        }))
      });
      this.newCustomerName = "";
      this.newCustomerTaxId = "";
      this.newCustomerAddress = "";
      this.newNotes = "";
      this.newItems = [emptyItem()];
      this.showCreate = false;
      await this.ctrl.load();
    } catch (e6) {
      this.formError = e6 instanceof Error ? e6.message : erploraT("ui.errCreate");
    } finally {
      this.saving = false;
    }
  }
  // ── render ────────────────────────────────────────────────────────────────
  // ── documento imprimible (ok-invoice) + estado AEAT ───────────────────────
  aeatStatusLabel(s5) {
    const map = {
      accepted: erploraT("ui.aeatAccepted"),
      pending: erploraT("ui.aeatPending"),
      rejected: erploraT("ui.aeatRejected"),
      error: erploraT("ui.aeatErrorStatus")
    };
    return s5 ? map[s5] ?? s5 : "";
  }
  aeatStatusColor(s5) {
    const map = { accepted: "success", pending: "warning", rejected: "danger", error: "danger" };
    return s5 && map[s5] || "medium";
  }
  /** tax_breakdown JSON {"21.00":{base,tax}} → líneas de impuesto de ok-invoice. */
  parseTaxes(d3) {
    let obj = {};
    try {
      obj = d3.tax_breakdown ? JSON.parse(d3.tax_breakdown) : {};
    } catch {
      obj = {};
    }
    const entries = Object.entries(obj);
    if (!entries.length) {
      return [{ label: "IVA", base: d3.base_amount, amount: d3.tax_amount }];
    }
    return entries.map(([rate, v3]) => {
      const r6 = Number(rate);
      return { label: `IVA ${Number.isFinite(r6) ? r6.toFixed(0) : rate}%`, rate: Number.isFinite(r6) ? r6 : void 0, base: Number(v3?.base ?? 0), amount: Number(v3?.tax ?? 0) };
    });
  }
  /** Factura → contrato ok-invoice (layout PDF/print) con el QR de VeriFactu. */
  invoiceDocData() {
    const d3 = this.detail;
    const qr = this.aeat?.qr || "";
    const csv = this.aeat?.csv || "";
    return {
      issuer: { name: d3.issuer_name || "\u2014", tax_id: d3.issuer_nif || void 0 },
      customer: { name: d3.customer_name || "\u2014", tax_id: d3.customer_tax_id || void 0, address: d3.customer_address || void 0 },
      number: d3.number,
      issue_date: d3.issue_date,
      lines: this.detailLines.map((l3) => ({ description: l3.description, qty: l3.quantity, unit_price: l3.unit_price, tax_rate: l3.tax_rate, total: l3.total_amount })),
      subtotal: d3.base_amount,
      taxes: this.parseTaxes(d3),
      tax_total: d3.tax_amount,
      total: d3.total_amount,
      currency: d3.currency || erplora().currency,
      qr: qr || void 0,
      qr_note: csv ? `CSV: ${csv}` : qr ? erploraT("ui.qrValidateNote") : void 0,
      footer: d3.notes || void 0
    };
  }
  renderAeatCard() {
    const a3 = this.aeat;
    if (!a3) return A;
    return b2`<div class="card aeat-card screen-only">
      <div class="aeat-head">
        <h3>${erploraT("ui.aeatTitle")}</h3>
        <ion-badge color=${this.aeatStatusColor(a3.status)}>${this.aeatStatusLabel(a3.status) || "\u2014"}</ion-badge>
      </div>
      ${a3.csv ? b2`<div class="kv"><span class="k">${erploraT("ui.aeatCsv")}</span><code>${a3.csv}</code></div>` : A}
      ${a3.qr ? b2`<div class="qr-wrap">
            <ok-qr value=${a3.qr} size="120" ec="M"></ok-qr>
            <span class="qr-note">${erploraT("ui.qrValidateNote")}</span>
            <a class="link" href=${a3.qr} target="_blank" rel="noopener noreferrer">${erploraT("ui.aeatValidateLink")}</a>
          </div>` : b2`<p class="muted">${erploraT("ui.aeatNoRecord")}</p>`}
    </div>`;
  }
  renderRectifyCard() {
    const t5 = this.rectifyTarget;
    if (!t5) return A;
    return b2`<div class="card">
      <h3>${erploraT("ui.rectifyTitle", { number: t5.number })}</h3>
      <p>${erploraT("ui.rectifyNote")}</p>
      <div class="form">
        <ion-textarea fill="outline" label-placement="floating" label=${erploraT("ui.lblReason")} placeholder=${erploraT("ui.rectifyReasonPlaceholder")} auto-grow .value=${this.rectifyReason} @ionInput=${(e6) => this.rectifyReason = e6.target.value}></ion-textarea>
      </div>
      <div class="row-actions">
        <ion-button size="small" color="danger" ?disabled=${this.busy || !this.rectifyReason.trim()} @click=${() => this.confirmRectify()}>${this.busy ? erploraT("ui.rectifying") : erploraT("ui.issueRectifying")}</ion-button>
        <ion-button size="small" fill="outline" color="medium" @click=${() => this.rectifyTarget = null}>${erploraT("ui.cancel")}</ion-button>
      </div>
    </div>`;
  }
  renderDetail() {
    const d3 = this.detail;
    return b2`<div>
      <header class="screen-only">
        <h2>${erploraT("ui.detailTitle", { number: d3.number })}</h2>
        <ion-badge color=${STATUS_COLOR[d3.status] ?? "medium"}>${statusLabel(d3.status)}</ion-badge>
        <ion-button size="small" @click=${() => window.print()}>
          <ion-icon slot="start" name="print-outline"></ion-icon> ${erploraT("ui.actionPrint")}
        </ion-button>
        <ion-button size="small" fill="outline" color="medium" @click=${() => this.closeDetail()}>← ${erploraT("ui.back")}</ion-button>
      </header>
      ${this.actionError ? b2`<p class="err screen-only">${this.actionError}</p>` : A}
      <div class="screen-only">${this.renderRectifyCard()}</div>
      ${this.renderAeatCard()}
      <div class="card screen-only">
        <dl class="grid">
          <div><dt>${erploraT("ui.fieldType")}</dt><dd>${typeLabel(d3.invoice_type)} (${d3.invoice_type})</dd></div>
          <div><dt>${erploraT("ui.fieldSeries")}</dt><dd>${d3.series}</dd></div>
          <div><dt>${erploraT("ui.fieldIssueDate")}</dt><dd>${d3.issue_date}</dd></div>
          <div><dt>${erploraT("ui.fieldCustomer")}</dt><dd>${d3.customer_name || "\u2014"}</dd></div>
          <div><dt>${erploraT("ui.fieldCustomerTaxId")}</dt><dd>${d3.customer_tax_id || "\u2014"}</dd></div>
          <div><dt>${erploraT("ui.fieldAddress")}</dt><dd>${d3.customer_address || "\u2014"}</dd></div>
          <div><dt>${erploraT("ui.fieldIssuer")}</dt><dd>${d3.issuer_name || "\u2014"} ${d3.issuer_nif ? `(${d3.issuer_nif})` : ""}</dd></div>
          <div><dt>${erploraT("ui.fieldSource")}</dt><dd>${d3.source_type}${d3.source_id ? ` \xB7 ${d3.source_id}` : ""}</dd></div>
          ${d3.rectifies_invoice_id ? b2`<div><dt>${erploraT("ui.fieldRectifies")}</dt><dd>${d3.rectifies_invoice_id}</dd></div>` : A}
          ${d3.paid_at ? b2`<div><dt>${erploraT("ui.fieldPaidAt")}</dt><dd>${d3.paid_at}</dd></div>` : A}
          ${d3.notes ? b2`<div><dt>${erploraT("ui.fieldNotes")}</dt><dd>${d3.notes}</dd></div>` : A}
        </dl>
        ${this.detailLines.length ? b2`<table class="lines">
          <thead><tr><th>#</th><th>${erploraT("ui.lineDescription")}</th><th>${erploraT("ui.lineQty")}</th><th>${erploraT("ui.linePrice")}</th><th>${erploraT("ui.lineTaxPct")}</th><th>${erploraT("ui.lineBase")}</th><th>${erploraT("ui.lineTax")}</th><th>${erploraT("ui.lineTotal")}</th></tr></thead>
          <tbody>${this.detailLines.map((l3) => b2`<tr>
            <td>${l3.line_number}</td><td>${l3.description}</td><td>${l3.quantity}</td>
            <td>${fmtDoc(l3.unit_price, d3.currency)}</td><td>${num(l3.tax_rate)}%</td>
            <td>${fmtDoc(l3.base_amount, d3.currency)}</td><td>${fmtDoc(l3.tax_amount, d3.currency)}</td><td>${fmtDoc(l3.total_amount, d3.currency)}</td>
          </tr>`)}</tbody>
        </table>` : b2`<p>${erploraT("ui.noLines")}</p>`}
        <div class="totals">
          <span>${erploraT("ui.totalBase")}: ${fmtDoc(d3.base_amount, d3.currency)}</span>
          <span>${erploraT("ui.totalTaxes")}: ${fmtDoc(d3.tax_amount, d3.currency)}</span>
          <span>${erploraT("ui.totalTotal")}: ${fmtDoc(d3.total_amount, d3.currency)}</span>
        </div>
        <div class="row-actions">
          ${this.canAdd && d3.status === "issued" ? b2`<ion-button size="small" color="success" ?disabled=${this.busy} @click=${() => this.markPaid(d3)}>${erploraT("ui.actionMarkPaid")}</ion-button>` : A}
          ${this.canRectify && !(d3.invoice_type ?? "").startsWith("R") && d3.status !== "cancelled" ? b2`<ion-button size="small" fill="outline" color="danger" ?disabled=${this.busy} @click=${() => this.startRectify(d3)}>${erploraT("ui.actionRectify")}</ion-button>` : A}
        </div>
      </div>
      <!-- Documento imprimible (solo al imprimir / Guardar como PDF): layout factura con QR VeriFactu. -->
      <div class="print-only"><ok-invoice .invoice=${this.invoiceDocData()}></ok-invoice></div>
    </div>`;
  }
  renderCreateForm() {
    return b2`<div class="card">
      <h3>${erploraT("ui.createTitle")}</h3>
      <form @submit=${(e6) => this.create(e6)}>
        <div class="form">
          <ion-select fill="outline" label-placement="floating" label=${erploraT("ui.fieldSeries")} interface="popover" .value=${this.newSeriesCode} @ionChange=${(e6) => this.newSeriesCode = e6.target.value}>
            ${this.seriesOptions.length ? this.seriesOptions.map((sr) => b2`<ion-select-option .value=${sr.code}>${sr.code} — ${sr.name || typeLabel(sr.invoice_type)}</ion-select-option>`) : b2`<ion-select-option value="FACT">FACT — ${typeLabel("F1")} (F1)</ion-select-option><ion-select-option value="TICKET">TICKET — ${typeLabel("F2")} (F2)</ion-select-option>`}
          </ion-select>
          <ion-input fill="outline" label-placement="floating" label=${erploraT("ui.fieldCustomer")} .value=${this.newCustomerName} @ionInput=${(e6) => this.newCustomerName = e6.target.value}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${erploraT("ui.fieldCustomerTaxId")} placeholder=${erploraT("ui.placeholderTaxId")} .value=${this.newCustomerTaxId} @ionInput=${(e6) => this.newCustomerTaxId = e6.target.value}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${erploraT("ui.fieldAddress")} .value=${this.newCustomerAddress} @ionInput=${(e6) => this.newCustomerAddress = e6.target.value}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${erploraT("ui.fieldNotes")} .value=${this.newNotes} @ionInput=${(e6) => this.newNotes = e6.target.value}></ion-input>
        </div>
        ${this.newItems.map((it, i8) => b2`<div class="item-row">
          <ion-input class="desc" fill="outline" label-placement="floating" label=${erploraT("ui.lineDescription")} .value=${it.description} @ionInput=${(e6) => this.setItem(i8, "description", e6.target.value)}></ion-input>
          <ion-input class="num" fill="outline" label-placement="floating" label=${erploraT("ui.lineQty")} type="number" .value=${it.quantity} @ionInput=${(e6) => this.setItem(i8, "quantity", e6.target.value)}></ion-input>
          <ion-input class="num" fill="outline" label-placement="floating" label=${erploraT("ui.linePrice")} type="number" .value=${it.unit_price} @ionInput=${(e6) => this.setItem(i8, "unit_price", e6.target.value)}></ion-input>
          <ion-input class="num" fill="outline" label-placement="floating" label=${erploraT("ui.lineTaxPct")} type="number" .value=${it.tax_rate} @ionInput=${(e6) => this.setItem(i8, "tax_rate", e6.target.value)}></ion-input>
          ${this.newItems.length > 1 ? b2`<ion-button size="small" fill="clear" color="danger" @click=${() => this.newItems = this.newItems.filter((_2, j2) => j2 !== i8)}>✕</ion-button>` : A}
        </div>`)}
        <div class="row-actions">
          <ion-button size="small" fill="outline" @click=${() => this.newItems = [...this.newItems, emptyItem()]}>${erploraT("ui.addLine")}</ion-button>
          <ion-button size="small" type="submit" ?disabled=${this.saving || !this.itemsValid}>${this.saving ? erploraT("ui.issuing") : erploraT("ui.issueInvoice")}</ion-button>
          <ion-button size="small" fill="clear" color="medium" @click=${() => this.showCreate = false}>${erploraT("ui.cancel")}</ion-button>
        </div>
        ${this.formError ? b2`<p class="err">${this.formError}</p>` : A}
      </form>
    </div>`;
  }
  render() {
    if (this.detail) return this.renderDetail();
    return b2`<div>
        <header>
          <h2>${erploraT("ui.pageTitle")}</h2>
          ${this.canAdd ? b2`<ion-button size="small" @click=${() => this.toggleCreate()}>${this.showCreate ? erploraT("ui.close") : erploraT("ui.newInvoice")}</ion-button>` : A}
        </header>
        ${this.showCreate ? this.renderCreateForm() : A}
        ${this.renderRectifyCard()}
        ${this.actionError ? b2`<p class="err">${this.actionError}</p>` : A}
        ${this.detailError ? b2`<p class="err">${this.detailError}</p>` : A}
        ${this.ctrl?.error ? b2`<p class="err">${this.ctrl.error}</p>` : A}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? "asc"} .searchable=${true} .searchPlaceholder=${erploraT("ui.searchPlaceholder")} .actions=${this.rowActions} .emptyMessage=${this.ctrl?.loading ? erploraT("ui.loading") : erploraT("ui.empty")} @rowAction=${(e6) => this.onRowAction(e6)} @pageChange=${(e6) => this.ctrl.setPage(e6.detail)} @sortChange=${(e6) => this.ctrl.setSort(e6.detail.sort, e6.detail.dir)} @searchChange=${(e6) => this.ctrl.setSearch(e6.detail)} @filterChange=${(e6) => this.ctrl.setFilter(e6.detail.col, e6.detail.value)}></ok-data-table>
      </div>`;
  }
};
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "tick", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "detail", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "detailLines", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "detailError", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "aeat", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "showCreate", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "saving", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "formError", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "newCustomerName", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "newCustomerTaxId", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "newCustomerAddress", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "newNotes", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "newSeriesCode", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "newItems", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "seriesOptions", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "rectifyTarget", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "rectifyReason", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "actionError", 2);
__decorateClass([
  r5()
], ErpInvoiceList.prototype, "busy", 2);
define("erp-invoice-list", ErpInvoiceList);

// ../modules-workspace/modules/invoice/ui/components/erp-invoice-settings/erp-invoice-settings.ts
var CATALOG2 = { es: es_default, en: en_default };
function erplora2() {
  const c5 = globalThis.erplora;
  if (!c5) throw new Error("erplora SDK no inicializado por el shell");
  return c5;
}
function erploraT2(key, params) {
  return erplora2().t(CATALOG2, key, params);
}
function typeLabel2(code) {
  const map = {
    F1: erploraT2("ui.typeInvoice"),
    F2: erploraT2("ui.typeTicket"),
    F3: erploraT2("ui.typeInvoice"),
    R1: erploraT2("ui.typeRectifying"),
    R2: erploraT2("ui.typeRectifying"),
    R3: erploraT2("ui.typeRectifying"),
    R4: erploraT2("ui.typeRectifying"),
    R5: erploraT2("ui.typeRectifying")
  };
  return map[code] ?? code;
}
var TYPE_CODES2 = ["F1", "F2", "F3", "R1", "R2", "R3", "R4", "R5"];
var blankForm = () => ({
  series_id: "",
  code: "",
  name: "",
  invoice_type: "F1",
  year: String((/* @__PURE__ */ new Date()).getFullYear()),
  prefix: "",
  is_active: true,
  is_default: false
});
var ErpInvoiceSettings = class extends i4 {
  constructor() {
    super(...arguments);
    this.rows = [];
    this.loading = false;
    this.listError = "";
    this.form = null;
    this.saving = false;
    this.formError = "";
    this.canManage = false;
    // Re-render al cambiar el idioma del shell (ADR-0055): los getters `columns`/`rowActions` y el
    // texto del template se re-evalúan con el nuevo `erplora.locale`.
    this.onLocaleChange = () => this.requestUpdate();
  }
  static {
    this.styles = i`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.5rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .err { color:#d9480f; font-weight:600; }
    .intro { color: var(--ion-color-medium,#8a8577); font-size:.85rem; margin:0 0 1rem; max-width:60ch; line-height:1.45; }
    .card { border:1px solid var(--ion-border-color,#e7e2d6); border-radius:10px; padding:1rem; margin-bottom:1rem; background:var(--ion-card-background,#fffdf7); }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0; }
    .form ion-input, .form ion-select { flex:1 1 11rem; min-width:9rem; }
    .toggles { display:flex; gap:1.5rem; flex-wrap:wrap; margin:.5rem 0; }
    .toggles ion-item { --background:transparent; --padding-start:0; --inner-padding-end:0; flex:1 1 12rem; }
    .hint { display:block; font-size:.72rem; color:var(--ion-color-medium,#8a8577); margin:-.25rem 0 .25rem; }
    .row-actions { display:flex; gap:.5rem; margin-top:.6rem; }
  `;
  }
  // Getter (no campo): se re-evalúa en cada render, así los textos cambian con el idioma activo
  // (ADR-0055). `connectedCallback` re-renderiza al recibir `erplora:locale-changed`.
  get columns() {
    const t5 = (k2) => erploraT2(k2);
    return [
      { key: "code", header: t5("ui.seriesColCode"), sortable: true, filterable: true, filterType: "text" },
      { key: "name", header: t5("ui.seriesColName"), sortable: true, filterable: true, filterType: "text", format: (r6) => r6.name || "\u2014" },
      {
        key: "invoice_type",
        header: t5("ui.seriesColType"),
        sortable: true,
        filterable: true,
        filterType: "select",
        options: TYPE_CODES2.map((value) => ({ value, label: typeLabel2(value) })),
        format: (r6) => `${typeLabel2(r6.invoice_type)} (${r6.invoice_type})`
      },
      { key: "year", header: t5("ui.seriesColYear"), align: "right", sortable: true },
      { key: "prefix", header: t5("ui.seriesColPrefix"), format: (r6) => r6.prefix || "\u2014" },
      { key: "current_number", header: t5("ui.seriesColNumber"), align: "right", sortable: true },
      {
        key: "is_active",
        header: t5("ui.seriesColActive"),
        render: (r6) => b2`<ion-badge color=${r6.is_active ? "success" : "medium"}>${r6.is_active ? t5("ui.yes") : t5("ui.no")}</ion-badge>`
      },
      {
        key: "is_default",
        header: t5("ui.seriesColDefault"),
        render: (r6) => r6.is_default ? b2`<ion-badge color="primary">${t5("ui.yes")}</ion-badge>` : b2`<span>—</span>`
      }
    ];
  }
  get rowActions() {
    if (!this.canManage) return [];
    return [{ id: "edit", label: erploraT2("ui.seriesActionEdit"), icon: "create-outline" }];
  }
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("erplora:locale-changed", this.onLocaleChange);
    try {
      this.canManage = erplora2().hasPermission?.("invoice.manage_series") ?? true;
    } catch {
    }
    await this.load();
  }
  disconnectedCallback() {
    window.removeEventListener("erplora:locale-changed", this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
  }
  async load() {
    this.loading = true;
    this.listError = "";
    try {
      const rows = await erplora2().query("invoice.series.list", {});
      this.rows = Array.isArray(rows) ? rows : [];
    } catch (e6) {
      this.listError = e6 instanceof Error ? e6.message : erploraT2("ui.errSeriesLoad");
    } finally {
      this.loading = false;
    }
  }
  // ── alta / edición ─────────────────────────────────────────────────────────
  startCreate() {
    this.formError = "";
    this.form = blankForm();
  }
  startEdit(row) {
    this.formError = "";
    this.form = {
      series_id: row.id,
      code: row.code,
      name: row.name || "",
      invoice_type: row.invoice_type,
      year: String(row.year ?? ""),
      prefix: row.prefix || "",
      is_active: !!row.is_active,
      is_default: !!row.is_default
    };
  }
  cancelForm() {
    this.form = null;
    this.formError = "";
  }
  setField(key, value) {
    if (!this.form) return;
    this.form = { ...this.form, [key]: value };
  }
  get isEdit() {
    return !!this.form?.series_id;
  }
  async submit(ev) {
    ev.preventDefault();
    const f3 = this.form;
    if (!f3) return;
    if (!this.isEdit && !f3.code.trim()) {
      this.formError = erploraT2("ui.errSeriesCodeRequired");
      return;
    }
    this.saving = true;
    this.formError = "";
    try {
      if (this.isEdit) {
        await erplora2().command("invoice.series.update", {
          series_id: f3.series_id,
          name: f3.name.trim(),
          prefix: f3.prefix.trim(),
          is_active: f3.is_active,
          is_default: f3.is_default
        });
      } else {
        await erplora2().command("invoice.series.create", {
          code: f3.code.trim(),
          name: f3.name.trim(),
          invoice_type: f3.invoice_type,
          year: Number(f3.year) || (/* @__PURE__ */ new Date()).getFullYear(),
          prefix: f3.prefix.trim(),
          is_active: f3.is_active,
          is_default: f3.is_default
        });
      }
      this.form = null;
      await this.load();
    } catch (e6) {
      this.formError = e6 instanceof Error ? e6.message : erploraT2(this.isEdit ? "ui.errSeriesUpdate" : "ui.errSeriesCreate");
    } finally {
      this.saving = false;
    }
  }
  onRowAction(ev) {
    if (ev.detail.actionId === "edit") this.startEdit(ev.detail.row);
  }
  // ── render ───────────────────────────────────────────────────────────────
  renderForm() {
    const f3 = this.form;
    const title = this.isEdit ? erploraT2("ui.seriesEditTitle", { code: f3.code }) : erploraT2("ui.seriesCreateTitle");
    return b2`<div class="card">
      <h3>${title}</h3>
      <form @submit=${(e6) => this.submit(e6)}>
        <div class="form">
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT2("ui.fieldCode")}
            ?disabled=${this.isEdit}
            .value=${f3.code}
            @ionInput=${(e6) => this.setField("code", e6.target.value)}></ion-input>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT2("ui.fieldName")}
            .value=${f3.name}
            @ionInput=${(e6) => this.setField("name", e6.target.value)}></ion-input>
          <ion-select
            fill="outline" label-placement="floating" label=${erploraT2("ui.fieldInvoiceType")}
            interface="popover" ?disabled=${this.isEdit}
            .value=${f3.invoice_type}
            @ionChange=${(e6) => this.setField("invoice_type", e6.target.value)}>
            ${TYPE_CODES2.map((c5) => b2`<ion-select-option .value=${c5}>${typeLabel2(c5)} (${c5})</ion-select-option>`)}
          </ion-select>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT2("ui.fieldYear")}
            type="number" ?disabled=${this.isEdit}
            .value=${f3.year}
            @ionInput=${(e6) => this.setField("year", e6.target.value)}></ion-input>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT2("ui.fieldPrefix")}
            .value=${f3.prefix}
            @ionInput=${(e6) => this.setField("prefix", e6.target.value)}></ion-input>
        </div>
        ${this.isEdit ? A : b2`<span class="hint">${erploraT2("ui.codeHint")}</span>`}
        <span class="hint">${erploraT2("ui.prefixHint")}</span>
        <div class="toggles">
          <ion-item lines="none">
            <ion-toggle .checked=${f3.is_active} @ionChange=${(e6) => this.setField("is_active", e6.target.checked)}>${erploraT2("ui.fieldActive")}</ion-toggle>
          </ion-item>
          <ion-item lines="none">
            <ion-toggle .checked=${f3.is_default} @ionChange=${(e6) => this.setField("is_default", e6.target.checked)}>${erploraT2("ui.fieldDefault")}</ion-toggle>
          </ion-item>
        </div>
        <div class="row-actions">
          <ion-button size="small" type="submit" ?disabled=${this.saving}>
            ${this.saving ? erploraT2(this.isEdit ? "ui.saving" : "ui.creating") : erploraT2(this.isEdit ? "ui.save" : "ui.create")}
          </ion-button>
          <ion-button size="small" fill="clear" color="medium" @click=${() => this.cancelForm()}>${erploraT2("ui.cancel")}</ion-button>
        </div>
        ${this.formError ? b2`<p class="err">${this.formError}</p>` : A}
      </form>
    </div>`;
  }
  render() {
    return b2`<div>
      <header>
        <h2>${erploraT2("ui.seriesTitle")}</h2>
        ${this.canManage && !this.form ? b2`<ion-button size="small" @click=${() => this.startCreate()}>
              <ion-icon slot="start" name="add-outline"></ion-icon>${erploraT2("ui.newSeries")}
            </ion-button>` : A}
      </header>
      <p class="intro">${erploraT2("ui.seriesIntro")}</p>
      ${this.form ? this.renderForm() : A}
      ${this.listError ? b2`<p class="err">${this.listError}</p>` : A}
      <ok-data-table
        .columns=${this.columns}
        .rows=${this.rows}
        .searchable=${true}
        .searchPlaceholder=${erploraT2("ui.seriesSearchPlaceholder")}
        .actions=${this.rowActions}
        .emptyMessage=${this.loading ? erploraT2("ui.seriesLoading") : erploraT2("ui.seriesEmpty")}
        @rowAction=${(e6) => this.onRowAction(e6)}></ok-data-table>
    </div>`;
  }
};
__decorateClass([
  r5()
], ErpInvoiceSettings.prototype, "rows", 2);
__decorateClass([
  r5()
], ErpInvoiceSettings.prototype, "loading", 2);
__decorateClass([
  r5()
], ErpInvoiceSettings.prototype, "listError", 2);
__decorateClass([
  r5()
], ErpInvoiceSettings.prototype, "form", 2);
__decorateClass([
  r5()
], ErpInvoiceSettings.prototype, "saving", 2);
__decorateClass([
  r5()
], ErpInvoiceSettings.prototype, "formError", 2);
define("erp-invoice-settings", ErpInvoiceSettings);
