// Unit tests for the pure pricing module (assets/gb-calculator.js).
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCalculator() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'gb-calculator.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.GB.Calculator;
}

const Calculator = loadCalculator();

test('no swaps: final price equals the preset base price', () => {
  const calc = new Calculator(150000, 10);
  const r = calc.compute([
    { nodeId: 'S1,1', originalSku: 'A', currentSku: 'A', originalPrice: 30000, currentPrice: 30000 },
  ]);
  assert.equal(r.delta, 0);
  assert.equal(r.discountAmount, 0);
  assert.equal(r.finalPrice, 150000);
  assert.equal(r.finalFormatted, '$1,500.00');
});

test('upgrade: delta is added and the discount applies to the delta only', () => {
  const calc = new Calculator(150000, 10);
  const r = calc.compute([
    { nodeId: 'S1,1', originalSku: 'A', currentSku: 'B', originalPrice: 30000, currentPrice: 40000 },
  ]);
  assert.equal(r.delta, 10000);
  assert.equal(r.discountAmount, 1000);
  assert.equal(r.finalPrice, 159000);
});

test('downgrade: negative delta lowers the price', () => {
  const calc = new Calculator(150000, 0);
  const r = calc.compute([
    { nodeId: 'S1,1', originalSku: 'B', currentSku: 'A', originalPrice: 40000, currentPrice: 30000 },
  ]);
  assert.equal(r.delta, -10000);
  assert.equal(r.finalPrice, 140000);
});

test('final price never goes below zero', () => {
  const calc = new Calculator(1000, 0);
  const r = calc.compute([
    { nodeId: 'S1,1', originalSku: 'B', currentSku: 'A', originalPrice: 50000, currentPrice: 0 },
  ]);
  assert.equal(r.finalPrice, 0);
});

test('empty slots (price 0) are handled without errors', () => {
  const calc = new Calculator(150000, 5);
  const r = calc.compute([
    { nodeId: 'EMPTY-S2,1', originalSku: '', currentSku: '', originalPrice: 0, currentPrice: 0 },
  ]);
  assert.equal(r.finalPrice, 150000);
  assert.equal(r.rows.length, 1);
});
