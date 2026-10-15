export function alignedRows(before,after,diffLines){
 const parts=diffLines(before,after,{timeout:1500,maxEditLength:20000});
 if(!parts)throw Error('差异过于复杂，无法在时限内完成；请缩小文件范围');
 const lines=text=>{if(!text)return [];const a=text.split('\n');if(a.at(-1)==='')a.pop();return a;};
 const rows=[];let oldLine=1,newLine=1;
 for(let i=0;i<parts.length;i++){
  const p=parts[i];if(!p.added&&!p.removed){for(const text of lines(p.value))rows.push({type:'context',old:oldLine++,new:newLine++,before:text,after:text});continue;}
  let removed=[],added=[];
  if(p.removed){removed=lines(p.value);if(parts[i+1]?.added)added=lines(parts[++i].value);}else added=lines(p.value);
  for(let n=0;n<Math.max(removed.length,added.length);n++)rows.push({type:'change',old:n<removed.length?oldLine++:null,new:n<added.length?newLine++:null,before:removed[n]??null,after:added[n]??null});
 }
 return rows;
}
export function diffEntries(rows,{full=false,expanded=new Set()}={}){
 const keep=rows.map((r,i)=>full||expanded.has(i)||r.type==='change');
 if(!full)for(let i=0;i<rows.length;i++)if(rows[i].type==='change')for(let j=Math.max(0,i-3);j<=Math.min(rows.length-1,i+3);j++)keep[j]=true;
 const result=[];for(let i=0;i<rows.length;){if(!keep[i]){const start=i;while(i<rows.length&&!keep[i])i++;result.push({fold:true,start,end:i,count:i-start});}else{result.push({...rows[i],index:i});i++;}}return result;
}

export function changeBlocks(rows){
 const blocks=[];
 for(let i=0;i<rows.length;){
  if(rows[i].type!=='change'){i++;continue;}
  const index=i;while(i<rows.length&&rows[i].type==='change')i++;
  const group=rows.slice(index,i),old=group.map(r=>r.old).filter(n=>n!==null),next=group.map(r=>r.new).filter(n=>n!==null);
  const range=lines=>lines.length?`第 ${lines[0]}${lines.length>1?'–'+lines.at(-1):''} 行`:'无对应行';
  const kind=!old.length?'新增':!next.length?'删除':'修改';
  blocks.push({index,label:`${kind} ${blocks.length+1} · 修改前：${range(old)} → 修改后：${range(next)}`});
 }
 return blocks;
}
