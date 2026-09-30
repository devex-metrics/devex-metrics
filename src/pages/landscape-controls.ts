/** Browser controls for the standalone landscape snapshot (independent of PR filters). */
export function getLandscapeControlsJS(): string {
  return `
document.addEventListener("DOMContentLoaded",function(){
  var tbody=document.getElementById("landscapeRows");
  if(!tbody||tbody.dataset.landscapeReady)return;
  tbody.dataset.landscapeReady="true";
  var table=tbody.closest("table");
  var buttons=Array.from(table.querySelectorAll(".landscape-sort"));
  var priorityButton=buttons.find(function(btn){return btn.dataset.landscapeSort==="priority";});
  var reset=document.getElementById("landscapeSortReset");
  var status=document.getElementById("landscapeSortStatus");
  var range=document.getElementById("landscapeRange");
  var pageLabel=document.getElementById("landscapePage");
  var prev=document.getElementById("landscapePrev");
  var next=document.getElementById("landscapeNext");
  function repoRows(){
    return Array.from(tbody.rows).filter(function(row){return !row.classList.contains("landscape-detail-row");});
  }
  function detailOf(row){
    var toggle=row.querySelector(".landscape-toggle");
    if(!toggle)return null;
    return row.landscapeDetail||(row.landscapeDetail=document.getElementById(toggle.getAttribute("aria-controls")));
  }
  var rows=repoRows();
  var key=null, direction=null, page=0;
  var collator=new Intl.Collator(undefined,{numeric:true,sensitivity:"base"});
  var isoTimestamp=/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/;
  var pageSize=20;
  var observer=new MutationObserver(function(){
    rows=repoRows();
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
  function sortValue(value){
    if(value==null||value.trim()==="")return null;
    if(key==="observed"){
      if(!isoTimestamp.test(value))return null;
      var timestamp=Date.parse(value);
      if(!Number.isFinite(timestamp))return null;
      var day=value.slice(0,10);
      return new Date(day+"T00:00:00Z").toISOString().slice(0,10)===day?timestamp:null;
    }
    var numeric=Number(value);
    return Number.isFinite(numeric)?numeric:null;
  }
  function compare(a,b){
    if(!key)return Number(a.dataset.landscapeIndex)-Number(b.dataset.landscapeIndex);
    var prop="landscape"+key.charAt(0).toUpperCase()+key.slice(1);
    var x=key==="name"?a.cells[1].textContent:a.dataset[prop];
    var y=key==="name"?b.cells[1].textContent:b.dataset[prop];
    var xValue=key==="name"?null:sortValue(x);
    var yValue=key==="name"?null:sortValue(y);
    if(key!=="name"){
      if(xValue===null||yValue===null){
        if(xValue===null&&yValue===null)return collator.compare(a.cells[1].textContent,b.cells[1].textContent)||
          Number(a.dataset.landscapeIndex)-Number(b.dataset.landscapeIndex);
        return xValue===null?1:-1;
      }
    }
    var result=key==="name"?collator.compare(x,y):xValue-yValue;
    return (direction==="descending"?-result:result)||
      collator.compare(a.cells[1].textContent,b.cells[1].textContent)||
      Number(a.dataset.landscapeIndex)-Number(b.dataset.landscapeIndex);
  }
  function render(){
    var sorted=rows.slice().sort(compare);
    observer.disconnect();
    var nodes=[];
    sorted.forEach(function(row){
      nodes.push(row);
      var detail=detailOf(row);
      if(detail)nodes.push(detail);
    });
    tbody.replaceChildren.apply(tbody,nodes);
    observer.observe(tbody,{childList:true});
    var pages=Math.max(1,Math.ceil(sorted.length/pageSize));
    page=Math.min(page,pages-1);
    sorted.forEach(function(row,i){
      row.hidden=i<page*pageSize||i>=(page+1)*pageSize;
      var detail=detailOf(row);
      if(detail)detail.hidden=row.hidden||row.querySelector(".landscape-toggle").getAttribute("aria-expanded")!=="true";
    });
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
      :"Attention first";
    buttons.forEach(function(btn){
      var current=btn===active?direction:!key&&btn===priorityButton?"ascending":"none";
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
  tbody.addEventListener("click",function(event){
    var toggle=event.target.closest(".landscape-toggle");
    if(!toggle)return;
    var expanded=toggle.getAttribute("aria-expanded")!=="true";
    toggle.setAttribute("aria-expanded",String(expanded));
    var detail=detailOf(toggle.closest("tr"));
    if(detail)detail.hidden=!expanded;
  });
  reset.addEventListener("click",function(){key=null;direction=null;page=0;render();});
  prev.addEventListener("click",function(){page=Math.max(0,page-1);render();});
  next.addEventListener("click",function(){page++;render();});
  render();
});
`;
}
