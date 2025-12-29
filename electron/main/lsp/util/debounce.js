function debounce(fn, waitMs) {
  let timer = null;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...(lastArgs || []));
    }, Math.max(0, Number(waitMs) || 0));
  };
}

module.exports = { debounce };

