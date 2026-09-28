/** Browser controls for the standalone landscape snapshot (independent of PR filters). */
export function getLandscapeControlsJS(): string {
  return `
document.addEventListener("DOMContentLoaded",function(){
  var tbody=document.getElementById("landscapeRows");
  if(!tbody||tbody.dataset.landscapeReady)return;
  tbody.dataset.landscapeReady="true";
  var table=tbody.closest("table");
  var buttons=Array.from(table.querySelectorAll(".landscape-sort"));
  var reset=document.getElementById("landscapeSortReset");
  var status=document.getElementById("landscapeSortStatus");
  var range=document.getElementById("landscapeRange");
  var pageLabel=document.getElementById("landscapePage");
  var prev=document.getElementById("landscapePrev");
  var next=document.getElementById("landscapeNext");
  var rows=Array.from(tbody.rows);
  var key=null, direction=null, page=0;
  var collator=new Intl.Collator(undefined,{numeric:true,sensitivity:"base"});
  var pageSize=20;
  var observer=new MutationObserver(function(){
    rows=Array.from(tbody.rows);
    var nextIndex=rows.reduce(function(max,row){
      return Math.max(max,Number(row.dataset.landscapeIndex??-1));
    },-1)+1;
    rows.forEach(function(row){
      if(!row.hasAttribute("data-landscape-index")){
        row.dataset.landscapeIndex=String(nextIndex++);
      }
    });
    page=0;
    render();
  });
  observer.observe(tbody,{childList:true});
  function compare(a,b){
    if(!key)return Number(a.dataset.landscapeIndex)-Number(b.dataset.landscapeIndex);
    var prop="landscape"+key.charAt(0).toUpperCase()+key.slice(1);
    var x=key==="name"?a.cells[0].textContent:a.dataset[prop];
    var y=key==="name"?b.cells[0].textContent:b.dataset[prop];
    if(key!=="name"){
      var xUnknown=x==null||x===""||(key!=="observed"&&!Number.isFinite(Number(x)));
      var yUnknown=y==null||y===""||(key!=="observed"&&!Number.isFinite(Number(y)));
      if(xUnknown||yUnknown){
        if(xUnknown&&yUnknown)return Number(a.dataset.landscapeIndex)-Number(b.dataset.landscapeIndex);
        return xUnknown?1:-1;
      }
    }
    var result=key==="name"?collator.compare(x,y):
      key==="observed"?x.localeCompare(y):Number(x)-Number(y);
    return (direction==="descending"?-result:result)||
      Number(a.dataset.landscapeIndex)-Number(b.dataset.landscapeIndex);
  }
  function render(){
    var sorted=rows.slice().sort(compare);
    observer.disconnect();
    tbody.replaceChildren.apply(tbody,sorted);
    observer.observe(tbody,{childList:true});
    var pages=Math.max(1,Math.ceil(sorted.length/pageSize));
    page=Math.min(page,pages-1);
    sorted.forEach(function(row,i){row.hidden=i<page*pageSize||i>=(page+1)*pageSize;});
    var start=sorted.length?page*pageSize+1:0;
    var end=Math.min((page+1)*pageSize,sorted.length);
    range.textContent="Showing "+start+"–"+end+" of "+sorted.length+" repositories";
    pageLabel.textContent="Page "+(page+1)+" of "+pages;
    prev.disabled=page===0;
    next.disabled=page>=pages-1;
    reset.disabled=!key;
    var active=buttons.find(function(btn){return btn.dataset.landscapeSort===key;});
    status.textContent=active
      ?"Sorted by "+active.dataset.landscapeLabel+" ("+(direction==="ascending"?"ascending":"descending")+")"
      :"Original order";
    buttons.forEach(function(btn){
      var current=btn===active?direction:"none";
      if(current==="none")btn.closest("th").removeAttribute("aria-sort");
      else btn.closest("th").setAttribute("aria-sort",current);
      btn.querySelector(".landscape-sort-ind").textContent=current==="none"?"↕":
        current==="ascending"?"↑":"↓";
      var nextDirection=btn===active?(direction==="ascending"?"descending":"ascending"):
        btn.dataset.landscapeDefault;
      btn.setAttribute("aria-label","Sort by "+btn.dataset.landscapeLabel+", "+nextDirection);
    });
  }
  buttons.forEach(function(btn){
    btn.addEventListener("click",function(){
      var selected=btn.dataset.landscapeSort;
      direction=key===selected?(direction==="ascending"?"descending":"ascending"):
        btn.dataset.landscapeDefault;
      key=selected;
      page=0;
      render();
    });
  });
  reset.addEventListener("click",function(){key=null;direction=null;page=0;render();});
  prev.addEventListener("click",function(){page=Math.max(0,page-1);render();});
  next.addEventListener("click",function(){page++;render();});
  render();
});
`;
}
