/**
 * Desmos-style expression field: ^ makes a superscript, never **.
 * Arrow up/down enter and leave the exponent; Backspace deletes it.
 */
(function mathInputModule() {
  const MAX_EXP_DEPTH = 3;
  function isLetter(ch) {
    return /[A-Za-z]/.test(ch);
  }
  function isDigitDot(ch) {
    return /[0-9.]/.test(ch);
  }
  function isSpace(ch) {
    return ch === " " || ch === "\t";
  }

  function lastAtomRange(row, at) {
    let end = at;
    while (end > 0 && row[end - 1].t === "c" && isSpace(row[end - 1].v)) end -= 1;
    if (end <= 0) return null;
    const item = row[end - 1];
    if (item.t === "pow") return [end - 1, end];
    if (item.t !== "c") return [end - 1, end];
    if (item.v === ")") {
      let depth = 0;
      let j = end - 1;
      for (; j >= 0; j -= 1) {
        const it = row[j];
        if (it.t !== "c") continue;
        if (it.v === ")") depth += 1;
        else if (it.v === "(") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j < 0) return [end - 1, end];
      let start = j;
      while (start > 0 && row[start - 1].t === "c" && isLetter(row[start - 1].v)) start -= 1;
      return [start, end];
    }
    if (isDigitDot(item.v)) {
      let start = end - 1;
      while (start > 0 && row[start - 1].t === "c" && isDigitDot(row[start - 1].v)) start -= 1;
      return [start, end];
    }
    if (isLetter(item.v)) {
      let start = end - 1;
      while (start > 0 && row[start - 1].t === "c" && isLetter(row[start - 1].v)) start -= 1;
      return [start, end];
    }
    return null;
  }

  function isSimpleAtom(row) {
    if (!row.length) return false;
    let i = 0;
    if (row[0].t === "c" && row[0].v === "-" && row.length > 1) i = 1;
    const rest = row.slice(i);
    if (!rest.length) return false;
    if (rest.every((it) => it.t === "c" && isDigitDot(it.v))) return true;
    if (rest.every((it) => it.t === "c" && isLetter(it.v))) return true;
    return false;
  }

  function isParenGroup(row) {
    if (row.length < 2) return false;
    const first = row[0];
    const last = row[row.length - 1];
    if (first.t !== "c" || first.v !== "(" || last.t !== "c" || last.v !== ")") return false;
    let depth = 0;
    for (let i = 0; i < row.length; i += 1) {
      const it = row[i];
      if (it.t !== "c") continue;
      if (it.v === "(") depth += 1;
      else if (it.v === ")") {
        depth -= 1;
        if (depth === 0 && i !== row.length - 1) return false;
      }
    }
    return depth === 0;
  }

  function isCallOrGroup(row) {
    if (isParenGroup(row)) return true;
    let i = 0;
    while (i < row.length && row[i].t === "c" && isLetter(row[i].v)) i += 1;
    if (i === 0 || i === row.length) return false;
    return isParenGroup(row.slice(i));
  }

  function serializeRow(row) {
    let out = "";
    for (const item of row) {
      if (item.t === "c") {
        out += item.v;
        continue;
      }
      if (item.t !== "pow") continue;
      const base = serializeRow(item.base);
      const exp = serializeRow(item.exp);
      const baseOut = !item.base.length || isSimpleAtom(item.base) || isCallOrGroup(item.base)
        ? base
        : `(${base})`;
      const expOut = !item.exp.length || isSimpleAtom(item.exp) ? exp : `(${exp})`;
      out += `${baseOut}^${expOut}`;
    }
    return out;
  }

  function parseToRow(text) {
    const src = String(text || "").replace(/\*\*/g, "^");
    let i = 0;

    function peek() {
      return src[i] || "";
    }

    function parseRow(stop, depth) {
      const row = [];
      while (i < src.length) {
        const ch = peek();
        if (stop && stop(ch)) break;
        if (ch === ")") break;
        if (isSpace(ch)) {
          i += 1;
          continue;
        }
        if (ch === "^") {
          i += 1;
          applyPower(row, depth);
          continue;
        }
        if (ch === "(") {
          i += 1;
          row.push({ t: "c", v: "(" });
          parseRow((c) => c === ")", depth).forEach((node) => row.push(node));
          if (peek() === ")") {
            row.push({ t: "c", v: ")" });
            i += 1;
          }
          continue;
        }
        row.push({ t: "c", v: ch });
        i += 1;
      }
      return row;
    }

    function parseExponent(depth) {
      if (peek() === "(") {
        i += 1;
        const inner = parseRow((c) => c === ")", depth);
        if (peek() === ")") i += 1;
        return inner;
      }
      const exp = [];
      if (peek() === "-") {
        exp.push({ t: "c", v: "-" });
        i += 1;
      }
      if (peek() === "(") {
        i += 1;
        exp.push({ t: "c", v: "(" });
        parseRow((c) => c === ")", depth).forEach((node) => exp.push(node));
        if (peek() === ")") {
          exp.push({ t: "c", v: ")" });
          i += 1;
        }
      } else if (isDigitDot(peek())) {
        while (isDigitDot(peek())) {
          exp.push({ t: "c", v: peek() });
          i += 1;
        }
      } else if (isLetter(peek())) {
        while (isLetter(peek())) {
          exp.push({ t: "c", v: peek() });
          i += 1;
        }
      }
      if (peek() === "^") {
        i += 1;
        applyPower(exp, depth);
      }
      return exp;
    }

    function applyPower(row, depth) {
      if (depth >= MAX_EXP_DEPTH) return;
      const range = lastAtomRange(row, row.length);
      const base = range ? row.splice(range[0], range[1] - range[0]) : [];
      row.push({ t: "pow", base, exp: parseExponent(depth + 1) });
    }

    return parseRow(null, 0);
  }

  function rowAt(root, path) {
    let row = root;
    for (const step of path) {
      const item = row[step.i];
      if (!item || item.t !== "pow") return row;
      row = item[step.slot];
    }
    return row;
  }

  function parentPow(root, path) {
    if (!path.length) return null;
    const parentPath = path.slice(0, -1);
    const step = path[path.length - 1];
    const row = rowAt(root, parentPath);
    return { row, step, item: row[step.i] };
  }

  class MathExprModel {
    constructor(text = "") {
      this.root = parseToRow(text);
      this.caret = { path: [], at: this.root.length };
    }

    getValue() {
      return serializeRow(this.root);
    }

    setValue(text) {
      this.root = parseToRow(text);
      this.caret = { path: [], at: this.root.length };
    }

    currentRow() {
      return rowAt(this.root, this.caret.path);
    }

    expDepth() {
      return this.caret.path.reduce((n, step) => n + (step.slot === "exp" ? 1 : 0), 0);
    }

    startPower() {
      if (this.expDepth() >= MAX_EXP_DEPTH) return;
      const row = this.currentRow();
      const range = lastAtomRange(row, this.caret.at);
      if (!range) {
        if (this.expDepth() > 0 && row.length === 0) return;
        row.splice(this.caret.at, 0, { t: "pow", base: [], exp: [] });
        this.caret.path.push({ i: this.caret.at, slot: "exp" });
        this.caret.at = 0;
        return;
      }
      if (range[1] - range[0] === 1) {
        const item = row[range[0]];
        if (item?.t === "pow" && item.exp.length === 0) {
          this.caret.path.push({ i: range[0], slot: "exp" });
          this.caret.at = 0;
          return;
        }
      }
      const base = row.splice(range[0], range[1] - range[0]);
      row.splice(range[0], 0, { t: "pow", base, exp: [] });
      this.caret.path.push({ i: range[0], slot: "exp" });
      this.caret.at = 0;
    }

    insertChar(ch) {
      if (!ch || ch === "^") {
        if (ch === "^") this.startPower();
        return;
      }
      const row = this.currentRow();
      row.splice(this.caret.at, 0, { t: "c", v: ch });
      this.caret.at += 1;
    }

    insertText(text) {
      const src = String(text || "").replace(/\r\n/g, "\n");
      if (src === "^") {
        this.startPower();
        return;
      }
      if (src.includes("^") || src.includes("**") || src.length > 1) {
        const left = serializeRow(this.currentRow().slice(0, this.caret.at));
        const right = serializeRow(this.currentRow().slice(this.caret.at));
        // Rebuild only the current row by splicing serialized sides.
        const combined = `${left}${src.replace(/\*\*/g, "^")}${right}`;
        const next = parseToRow(combined);
        const parent = parentPow(this.root, this.caret.path);
        if (!parent) {
          this.root = next;
        } else {
          parent.item[parent.step.slot] = next;
        }
        this.caret.at = parseToRow(left + src.replace(/\*\*/g, "^")).length;
        return;
      }
      for (const ch of src) {
        if (ch === "^") this.startPower();
        else if (ch !== "\n") this.insertChar(ch);
      }
    }

    backspace() {
      const row = this.currentRow();
      if (this.caret.at > 0) {
        const idx = this.caret.at - 1;
        const item = row[idx];
        if (item.t === "pow") {
          if (item.exp.length) {
            item.exp.pop();
            this.caret.path.push({ i: idx, slot: "exp" });
            this.caret.at = item.exp.length;
            return;
          }
          row.splice(idx, 1, ...item.base);
          this.caret.at = idx + item.base.length;
          return;
        }
        row.splice(idx, 1);
        this.caret.at = idx;
        return;
      }
      if (!this.caret.path.length) return;
      const step = this.caret.path[this.caret.path.length - 1];
      const parent = parentPow(this.root, this.caret.path);
      if (!parent?.item) return;
      if (step.slot === "exp") {
        this.caret.path.pop();
        parent.row.splice(step.i, 1, ...parent.item.base);
        this.caret.at = step.i + parent.item.base.length;
        return;
      }
      this.caret.path.pop();
      this.caret.at = step.i;
    }

    deleteForward() {
      const row = this.currentRow();
      if (this.caret.at < row.length) {
        const item = row[this.caret.at];
        if (item.t === "pow") {
          if (item.base.length) {
            item.base.shift();
            this.caret.path.push({ i: this.caret.at, slot: "base" });
            this.caret.at = 0;
            if (!item.base.length && !item.exp.length) {
              this.caret.path.pop();
              row.splice(this.caret.at, 1);
            }
            return;
          }
          if (item.exp.length) {
            item.exp.shift();
            this.caret.path.push({ i: this.caret.at, slot: "exp" });
            this.caret.at = 0;
            return;
          }
        }
        row.splice(this.caret.at, 1);
        return;
      }
      if (!this.caret.path.length) return;
      const step = this.caret.path.pop();
      if (step.slot === "base") {
        this.caret.path.push({ i: step.i, slot: "exp" });
        this.caret.at = 0;
        return;
      }
      this.caret.at = step.i + 1;
    }

    moveLeft() {
      const row = this.currentRow();
      if (this.caret.at > 0) {
        const item = row[this.caret.at - 1];
        if (item.t === "pow") {
          this.caret.path.push({ i: this.caret.at - 1, slot: "exp" });
          this.caret.at = item.exp.length;
          return;
        }
        this.caret.at -= 1;
        return;
      }
      if (!this.caret.path.length) return;
      const step = this.caret.path.pop();
      const parent = parentPow(this.root, [...this.caret.path, step]);
      const item = parent?.item;
      if (step.slot === "exp" && item) {
        this.caret.path.push({ i: step.i, slot: "base" });
        this.caret.at = item.base.length;
        return;
      }
      this.caret.at = step.i;
    }

    moveRight() {
      const row = this.currentRow();
      if (this.caret.at < row.length) {
        const item = row[this.caret.at];
        if (item.t === "pow") {
          this.caret.path.push({ i: this.caret.at, slot: "base" });
          this.caret.at = 0;
          return;
        }
        this.caret.at += 1;
        return;
      }
      if (!this.caret.path.length) return;
      const step = this.caret.path.pop();
      if (step.slot === "base") {
        this.caret.path.push({ i: step.i, slot: "exp" });
        this.caret.at = 0;
        return;
      }
      this.caret.at = step.i + 1;
    }

    moveUp() {
      const row = this.currentRow();
      if (this.caret.path.length) {
        const step = this.caret.path[this.caret.path.length - 1];
        if (step.slot === "base") {
          const item = rowAt(this.root, this.caret.path.slice(0, -1))[step.i];
          step.slot = "exp";
          this.caret.at = Math.min(this.caret.at, item.exp.length);
          return true;
        }
      }
      if (this.caret.at > 0 && row[this.caret.at - 1]?.t === "pow") {
        const item = row[this.caret.at - 1];
        this.caret.path.push({ i: this.caret.at - 1, slot: "exp" });
        this.caret.at = item.exp.length;
        return true;
      }
      if (this.caret.at < row.length && row[this.caret.at]?.t === "pow") {
        this.caret.path.push({ i: this.caret.at, slot: "exp" });
        this.caret.at = 0;
        return true;
      }
      return false;
    }

    moveDown() {
      if (!this.caret.path.length) return false;
      const step = this.caret.path[this.caret.path.length - 1];
      if (step.slot === "exp" || step.slot === "base") {
        this.caret.path.pop();
        this.caret.at = step.i + 1;
        return true;
      }
      return false;
    }

    moveHome() {
      this.caret.at = 0;
    }

    moveEnd() {
      this.caret.at = this.currentRow().length;
    }

    inExponent() {
      return this.caret.path.some((step) => step.slot === "exp");
    }
  }

  function caretMark() {
    const mark = document.createElement("span");
    mark.className = "math-caret";
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function renderRow(row, path, caret, into) {
    const here =
      caret?.path &&
      path.length === caret.path.length &&
      path.every((step, i) => step.i === caret.path[i].i && step.slot === caret.path[i].slot);
    const addCaret = (at) => {
      if (here && caret.at === at) into.appendChild(caretMark());
    };
    addCaret(0);
    row.forEach((item, i) => {
      if (item.t === "c") {
        const ch = document.createElement("span");
        ch.className = "math-ch";
        ch.textContent = item.v;
        ch.dataset.at = String(i + 1);
        ch.dataset.path = JSON.stringify(path);
        into.appendChild(ch);
      } else if (item.t === "pow") {
        const wrap = document.createElement("span");
        wrap.className = "math-pow";
        const base = document.createElement("span");
        base.className = "math-pow-base";
        if (!item.base.length) {
          base.classList.add("is-empty");
          base.dataset.at = "0";
          base.dataset.path = JSON.stringify(path.concat({ i, slot: "base" }));
        }
        renderRow(item.base, path.concat({ i, slot: "base" }), caret, base);
        const exp = document.createElement("span");
        exp.className = "math-pow-exp";
        if (!item.exp.length) {
          exp.classList.add("is-empty");
          exp.dataset.at = "0";
          exp.dataset.path = JSON.stringify(path.concat({ i, slot: "exp" }));
        }
        renderRow(item.exp, path.concat({ i, slot: "exp" }), caret, exp);
        wrap.append(base, exp);
        wrap.dataset.at = String(i + 1);
        wrap.dataset.path = JSON.stringify(path);
        into.appendChild(wrap);
      }
      addCaret(i + 1);
    });
  }

  class MathInputView {
    constructor(input) {
      this.input = input;
      this.model = new MathExprModel(input.value);
      this.host = document.createElement("div");
      this.host.className = "math-input";
      this.host.tabIndex = 0;
      this.host.setAttribute("role", "textbox");
      this.host.setAttribute("aria-multiline", "false");
      this.host.setAttribute("spellcheck", "false");
      const label = input.getAttribute("aria-label") || input.closest("aside")?.querySelector("label")?.textContent;
      if (label) this.host.setAttribute("aria-label", label.replace(/\s+/g, " ").trim());

      this.wrap = document.createElement("div");
      this.wrap.className = "math-input-wrap";
      input.parentNode.insertBefore(this.wrap, input);
      this.wrap.appendChild(this.host);
      this.wrap.appendChild(input);
      input.classList.add("math-expr-src");
      input.tabIndex = -1;
      input.setAttribute("aria-hidden", "true");
      input.autocomplete = "off";

      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      Object.defineProperty(input, "value", {
        configurable: true,
        get: () => this.model.getValue(),
        set: (v) => {
          this.model.setValue(v);
          desc.set.call(input, this.model.getValue());
          this.render();
        },
      });
      desc.set.call(input, this.model.getValue());

      this.host.addEventListener("keydown", (event) => this.onKey(event));
      this.host.addEventListener("paste", (event) => this.onPaste(event));
      this.host.addEventListener("mousedown", (event) => this.onPointer(event));
      this.host.addEventListener("focus", () => this.host.classList.add("is-focused"));
      this.host.addEventListener("blur", () => {
        this.host.classList.remove("is-focused");
        this.render();
      });
      this.render();
    }

    emitInput() {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      desc.set.call(this.input, this.model.getValue());
      this.input.dispatchEvent(new Event("input", { bubbles: true }));
      this.input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    render() {
      this.host.replaceChildren();
      const row = document.createElement("span");
      row.className = "math-row";
      if (!this.model.root.length) {
        const ph = document.createElement("span");
        ph.className = "math-placeholder";
        ph.textContent = "";
        row.appendChild(ph);
      }
      const caret = this.host === document.activeElement ? this.model.caret : null;
      renderRow(this.model.root, [], caret, row);
      if (caret && !row.querySelector(".math-caret")) {
        row.appendChild(caretMark());
      }
      this.host.appendChild(row);
      const caretEl = this.host.querySelector(".math-caret");
      if (caretEl) {
        caretEl.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }

    onKey(event) {
      const key = event.key;
      if (event.metaKey || event.ctrlKey) {
        if (key === "c" || key === "x") {
          event.preventDefault();
          navigator.clipboard?.writeText(this.model.getValue());
          if (key === "x") {
            this.model.setValue("");
            this.render();
            this.emitInput();
          }
        }
        if (key === "v") return;
        if (key === "a") event.preventDefault();
        return;
      }
      if (key === "ArrowLeft") {
        event.preventDefault();
        this.model.moveLeft();
        this.render();
        return;
      }
      if (key === "ArrowRight") {
        event.preventDefault();
        this.model.moveRight();
        this.render();
        return;
      }
      if (key === "ArrowUp") {
        event.preventDefault();
        this.model.moveUp();
        this.render();
        return;
      }
      if (key === "ArrowDown") {
        event.preventDefault();
        this.model.moveDown();
        this.render();
        return;
      }
      if (key === "Home") {
        event.preventDefault();
        this.model.moveHome();
        this.render();
        return;
      }
      if (key === "End") {
        event.preventDefault();
        this.model.moveEnd();
        this.render();
        return;
      }
      if (key === "Backspace") {
        event.preventDefault();
        this.model.backspace();
        this.render();
        this.emitInput();
        return;
      }
      if (key === "Delete") {
        event.preventDefault();
        this.model.deleteForward();
        this.render();
        this.emitInput();
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        this.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        this.input.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      if (key === "Tab" || key === "Escape") return;
      if (key.length === 1 && !event.altKey) {
        event.preventDefault();
        if (key === "*") {
          this.model.insertChar("*");
        } else {
          this.model.insertText(key);
        }
        this.render();
        this.emitInput();
      }
    }

    onPaste(event) {
      event.preventDefault();
      const text = event.clipboardData?.getData("text") || "";
      this.model.insertText(text);
      this.render();
      this.emitInput();
    }

    onPointer(event) {
      this.host.focus();
      const target = event.target.closest("[data-at]");
      if (!target) {
        this.model.caret = { path: [], at: this.model.root.length };
        this.render();
        return;
      }
      try {
        const path = JSON.parse(target.dataset.path || "[]");
        const at = Number(target.dataset.at);
        this.model.caret = { path, at: Number.isFinite(at) ? at : 0 };
      } catch {
        this.model.caret = { path: [], at: this.model.root.length };
      }
      this.render();
      event.preventDefault();
    }
  }

  function upgrade(input) {
    if (!input || input.dataset.mathReady === "1") return null;
    input.dataset.mathReady = "1";
    return new MathInputView(input);
  }

  function upgradeAll(root = document) {
    root.querySelectorAll("input.math-expr").forEach((input) => upgrade(input));
  }

  window.MathInput = {
    upgrade,
    upgradeAll,
    parse: parseToRow,
    serialize: serializeRow,
    Model: MathExprModel,
    MAX_EXP_DEPTH,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => upgradeAll());
  } else {
    upgradeAll();
  }
})();
