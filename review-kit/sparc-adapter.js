// SPARC dashboards ↔ review kit.
// 1) Paste the Apps Script web app URL (ending in /exec) into `endpoint` below.
// 2) Page awareness: each dashboard is its own HTML file and switches pages with #hash.
window.reviewKitConfig = {
  endpoint: 'https://script.google.com/macros/s/AKfycby4YjrRkjL2Fcwt3xWJVYHnNaYVolEAjqoGs4ukI-kVw72OPS74_RdXAcQirVAPHy5j/exec',
  project: 'sparc',
};

window.reviewKitAdapter = (function () {
  var DASHBOARDS = {
    state: { file: 'SPARC_State_Dashboard_New.html', role: 'State', title: 'State Dashboard',
      pages: { overview: 'Overview', coverage: 'Teacher Coverage', competency: 'Teacher Competencies', engagement: 'Student Engagement' } },
    district: { file: 'SPARC_District_Dashboard_New.html', role: 'District', title: 'District Dashboard',
      pages: { overview: 'Overview', coverage: 'Coverage & Caseload', competency: 'Teacher Competencies', engagement: 'Student Engagement' } },
    sef: { file: 'SPARC_SEF_Internal_Dashboard_new.html', role: 'SEF Internal', title: 'SEF Internal',
      pages: { overview: 'Overview', coverage: 'Coverage & Caseload', competency: 'Teacher Competencies', engagement: 'Student Engagement' } },
    coach: { file: 'SPARC_Coach_View_new.html', role: 'Coach', title: 'Coach View',
      pages: { home: 'Dashboard', todo: 'Visits', practice: 'Practice', engagement: 'Students', history: 'Teachers' } },
    usage: { file: 'SPARC_Usage_Dashboard.html', role: 'Usage', title: 'Usage Dashboard',
      pages: { overview: 'Overview' } },
  };

  // Netlify serves pretty URLs (e.g. /sparc_district_dashboard_new), so compare case-insensitively without .html.
  function base(name) { return decodeURIComponent(name || '').toLowerCase().replace(/\.html?$/, ''); }
  function current() {
    var file = base(location.pathname.split('/').pop());
    for (var k in DASHBOARDS) if (base(DASHBOARDS[k].file) === file) return k;
    return 'state'; // the site root (/) serves the State dashboard
  }

  function screen(d) {
    var h = location.hash.replace(/^#/, '');
    return Object.prototype.hasOwnProperty.call(d.pages, h) ? h : Object.keys(d.pages)[0];
  }

  return {
    getPage: function () {
      var k = current(), d = DASHBOARDS[k], s = screen(d);
      return { key: k + ':' + s, label: d.title + ' › ' + d.pages[s], role: d.role };
    },
    goTo: function (key) {
      var parts = String(key).split(':'), d = DASHBOARDS[parts[0]];
      if (!d || !Object.prototype.hasOwnProperty.call(d.pages, parts[1])) return false;
      if (parts[0] === current()) location.hash = parts[1];
      else location.href = d.file + '#' + parts[1];
      return true;
    },
  };
})();
