export function bindVerticalScale(prefix, apply) {
  const control = name => document.getElementById(prefix + '-' + name);
  const range = control('exaggeration'), number = control('exaggeration-number');
  const output = control('scale-label');
  function setScale(value) {
    const scale = Math.max(+range.min, Math.min(+range.max, Number.isFinite(value) ? value : range.valueAsNumber)).toFixed(1);
    range.value = number.value = scale;
    output.value = '×' + scale;
    apply(scale);
  }
  range.oninput = () => setScale(range.valueAsNumber);
  number.onchange = () => setScale(number.valueAsNumber);
  control('true-scale').onclick = () => setScale(1);
  return setScale;
}
