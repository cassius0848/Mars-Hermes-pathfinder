export const atlasExamples = {
  jezero: { name: 'Jezero', site: 'jezero', target: 1, source: 'jezero' },
  hawksbill: { name: 'Hawksbill Gap', site: 'hawksbill', target: 0, source: 'auto' },
  neretva: { name: 'Neretva Vallis', site: 'neretva', target: 0, source: 'auto' },
  gale: { name: 'Gale', start: [137.34, -4.65], goal: [137.46, -4.55], source: 'auto' },
  endeavour: { name: 'Endeavour', start: [-5.59, -2.00], goal: [-5.47, -1.90], source: 'auto' },
  eberswalde: { name: 'Eberswalde', start: [-33.36, -23.85], goal: [-33.24, -23.75], source: 'auto' },
};

export function sourceForArea(area, source) {
  const jezero = ['jezero', 'hawksbill', 'neretva'].includes(area);
  if ((source === 'jezero' || source === 'ctx') && !jezero) return 'auto';
  if (source === 'local' && !['hawksbill', 'neretva'].includes(area)) return 'auto';
  return source;
}
