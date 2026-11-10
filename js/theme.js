// Runs before the page paints so dark mode never flashes. Kept as a file (not inline) so the CSP can forbid inline scripts.
try { document.documentElement.dataset.theme = localStorage.getItem('wb-theme') || 'light'; } catch (e) { /* storage blocked */ }
