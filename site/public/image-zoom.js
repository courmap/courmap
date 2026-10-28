// Click a screenshot in the docs to see it larger. Plain script, no dependencies; without it the images stay as they are.
(function () {
  var dialog;
  function open(img) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'image-zoom';
      dialog.addEventListener('click', function () { dialog.close(); });
      document.body.appendChild(dialog);
    }
    var big = document.createElement('img');
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    dialog.replaceChildren(big);
    dialog.showModal();
  }
  function init() {
    if (!document.createElement('dialog').showModal) return;
    document.querySelectorAll('.sl-markdown-content img').forEach(function (img) {
      img.classList.add('zoomable');
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.addEventListener('click', function () { open(img); });
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
