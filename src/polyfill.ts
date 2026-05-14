// @ts-nocheck
// Chrome 60+ 兼容 polyfills

if (typeof globalThis === 'undefined') {
  (function (g: typeof globalThis) { g.globalThis = g; })(
    typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : Function('return this')()
  );
}

if (typeof Promise.prototype.finally === 'undefined') {
  Promise.prototype.finally = function (cb) {
    const P = Promise;
    return this.then(
      (v) => P.resolve(cb()).then(() => v),
      (e) => P.resolve(cb()).then(() => { throw e; })
    );
  };
}
