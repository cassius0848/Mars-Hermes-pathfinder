// The home page opens the regional atlas. Keep existing mission deep links working.
(() => {
  const current = new URL(window.location.href);
  const mission = current.searchParams.has('area') || Boolean(current.hash);
  const target = new URL(mission ? './mission.html' : './atlas.html', current);
  target.search = current.search;
  target.hash = current.hash;
  if (!mission) target.searchParams.set('area', 'jezero');
  window.location.replace(target.href);
})();
