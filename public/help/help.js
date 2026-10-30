(function(){var q=document.getElementById('q'),main=document.querySelector('main'),orig=main.innerHTML,idx=null;
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function load(cb){if(idx)return cb();fetch('search.json').then(function(r){return r.json()}).then(function(j){idx=j;cb()})}
function search(t){t=t.trim().toLowerCase();if(!t){main.innerHTML=orig;return}load(function(){var w=t.split(/\s+/),hits=idx.pages.filter(function(p){var s=(p.title+' '+p.text).toLowerCase();return w.every(function(x){return s.indexOf(x)>=0})});
main.innerHTML='<h1>Search: '+esc(t)+'</h1>'+(hits.length?'<ul id="results">'+hits.map(function(p){return '<li><a href="'+p.slug+'.html">'+esc(p.title)+'</a><br><small>'+esc(p.summary||'')+'</small></li>'}).join('')+'</ul>':'<p>Nothing found. Try fewer or other words.</p>')})}
if(q){q.addEventListener('input',function(){search(q.value)});}
var m=new URLSearchParams(location.search).get('m');if(m){load(function(){var s=idx.modules[m];if(s){location.replace(s+'.html')}else{var n=document.getElementById('notice');if(n){n.style.display='block'}}})}})();
(function(){var b=document.getElementById('theme');if(!b)return;var r=document.documentElement;
function dark(){var t=r.getAttribute('data-theme');return t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches}
function label(){b.textContent=dark()?'Light mode':'Dark mode'}
b.addEventListener('click',function(){var t=dark()?'light':'dark';r.setAttribute('data-theme',t);try{localStorage.setItem('erp-theme',t)}catch(e){}label()});label()})();
(function(){var b=document.getElementById('back');if(!b)return;b.addEventListener('click',function(e){e.preventDefault();try{window.close()}catch(x){}setTimeout(function(){location.href='/'},300)})})();
