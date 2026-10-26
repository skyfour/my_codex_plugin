// Task identity stays stable while each commit describes a different implementation stage.
export function hasCommitKeyword(text,keyword){
 const identifiers=value=>value.match(/(?:^|\s)--(?:task|story|bug)=\d+@tapd-\d+(?=\s|$)/g)?.map(token=>token.trim())??[];
 const expected=identifiers(keyword??'');
 return expected.length===1&&identifiers(text).includes(expected[0]);
}
