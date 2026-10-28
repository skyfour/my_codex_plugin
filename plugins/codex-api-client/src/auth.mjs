// Field names mirror postman-runtime 7.56 authorizer auth.get schemas. No local signer.
export const AUTH_FIELDS={
 noauth:[],basic:['username','password'],bearer:['token'],apikey:['key','value','in'],
 digest:['username','password','realm','nonce','algorithm','qop','nonceCount','clientNonce','opaque'],
 oauth1:['consumerKey','consumerSecret','token','tokenSecret','privateKey','signatureMethod','callback','verifier','timestamp','nonce','version','realm','includeBodyHash','addParamsToHeader','addEmptyParamsToSign','disableHeaderEncoding'],
 oauth2:['accessToken','addTokenTo','tokenType','headerPrefix'],
 awsv4:['accessKey','secretKey','sessionToken','service','region','addAuthDataToQuery'],
 hawk:['authId','authKey','algorithm','nonce','timestamp','extraData','app','delegation','user','includePayloadHash'],
 ntlm:['username','password','domain','workstation','disableRetryRequest'],
 edgegrid:['accessToken','clientToken','clientSecret','baseURL','nonce','timestamp','headersToSign','maxBodySize'],
 jwt:['algorithm','header','payload','secret','isSecretBase64Encoded','privateKey','addTokenTo','headerPrefix','queryParamKey'],
 asap:['alg','kid','iss','exp','aud','sub','privateKey','claims'],
};
export const AUTH_SECRETS=['password','token','value','consumerSecret','tokenSecret','privateKey','verifier','accessToken','secretKey','sessionToken','authKey','clientToken','clientSecret','refreshToken','secret'];
export const AUTH_BOOLEANS=['includeBodyHash','addParamsToHeader','addEmptyParamsToSign','disableHeaderEncoding','addAuthDataToQuery','includePayloadHash','disableRetryRequest','isSecretBase64Encoded'];
export const AUTH_DEFAULTS={apikey:{in:'header'},digest:{algorithm:'MD5'},oauth1:{signatureMethod:'HMAC-SHA1',addParamsToHeader:true},oauth2:{addTokenTo:'header',tokenType:'bearer',headerPrefix:'Bearer'},hawk:{algorithm:'sha256'},jwt:{algorithm:'HS256',payload:'{}',addTokenTo:'header'},asap:{alg:'RS256',exp:3600}};
export const AUTH_REQUIRED={basic:['username','password'],bearer:['token'],apikey:['key','value'],digest:['username','password'],oauth1:['consumerKey','signatureMethod'],oauth2:['accessToken'],awsv4:['accessKey','secretKey','region','service'],hawk:['authId','authKey','algorithm'],ntlm:['username','password'],edgegrid:['accessToken','clientToken','clientSecret'],jwt:['algorithm'],asap:['kid','iss','aud','privateKey']};
export function authProblem(auth){
 if(!auth||auth.type==='noauth')return '';
 if(!AUTH_FIELDS[auth.type])return 'UNSUPPORTED: 不支持认证方式';
 const p=Object.fromEntries((auth[auth.type]||[]).filter(v=>!v.disabled).map(v=>[v.key,v.value]));
 if(auth.type==='asap'){
  let claims=p.claims||{};
  if(typeof claims==='string'){try{claims=claims.trim()&&JSON.parse(claims.trim());}catch{return 'AUTH_INVALID: ASAP claims JSON 无效';}}
  if(claims===null)return 'AUTH_INVALID: ASAP claims 无效';
  // Native ASAP gives truthy claims values precedence over top-level fields.
  for(const key of ['kid','iss','aud'])p[key]=claims[key]||p[key];
  if(['kid','iss','aud','privateKey'].some(key=>!p[key]))return 'AUTH_INVALID: ASAP 必需字段不完整（kid, iss, aud, privateKey）';
 }
 const need=[...(AUTH_REQUIRED[auth.type]||[])];
 if(auth.type==='oauth1')need.push(String(p.signatureMethod).startsWith('RSA')?'privateKey':'consumerSecret');
 if(auth.type==='jwt')need.push(String(p.algorithm).startsWith('HS')?'secret':'privateKey');
 if(need.some(k=>p[k]===undefined||p[k]===''))return 'UNSUPPORTED: 认证字段不完整（'+need.join(', ')+'）';
 const enums={apikey:{in:['header','query']},oauth1:{signatureMethod:['HMAC-SHA1','HMAC-SHA256','HMAC-SHA512','RSA-SHA1','RSA-SHA256','RSA-SHA512','PLAINTEXT']},jwt:{algorithm:['HS256','HS384','HS512','RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512'],addTokenTo:['header','queryParam']},hawk:{algorithm:['sha1','sha256']},digest:{algorithm:['MD5','MD5-sess','SHA-256','SHA-256-sess','SHA-512-256','SHA-512-256-sess']}};
 for(const [key,values]of Object.entries(enums[auth.type]||{}))if(p[key]&&!String(p[key]).includes('{{')&&!values.includes(p[key]))return 'AUTH_INVALID: '+auth.type+'.'+key+' 不支持此值';
 if(auth.type==='oauth2'&&((p.tokenType&&String(p.tokenType).toLowerCase()!=='bearer')||(p.addTokenTo&&!['header','queryParams'].includes(p.addTokenTo))))return 'AUTH_INVALID: OAuth2 仅支持 Bearer，位置为 header/queryParams';
 return '';
}
// Applied at the Store batch boundary, including encrypted restore and legacy import.
export function markCredentials(input){
 const visit=value=>{
  if(Array.isArray(value))return value.map(visit);
  if(!value||typeof value!=='object')return value;
  const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));
  if(out.auth){for(const [type,fields]of Object.entries(AUTH_FIELDS))if(Array.isArray(out.auth[type]))out.auth[type]=out.auth[type].map(v=>AUTH_SECRETS.includes(v.key)?{...v,type:'secret'}:v);}
  if(/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-amz-security-token)$/i.test(String(out.key||'')))out.type='secret';
  if(typeof out.proxy==='string'){
    try{const url=new URL(out.proxy);if(url.username||url.password){out.proxyCredentials=[{key:'username',value:decodeURIComponent(url.username),type:'secret'},{key:'password',value:decodeURIComponent(url.password),type:'secret'}];url.username='';url.password='';out.proxy=url.toString();}}catch{throw new Error('PROXY: 无效代理地址');}
  }
  for(const [field,key]of [['proxyUsername','username'],['proxyPassword','password']])if(typeof out[field]==='string'){out.proxyCredentials=[...(out.proxyCredentials||[]).filter(v=>v.key!==key),{key,value:out[field],type:'secret'}];delete out[field];}
  if(Array.isArray(out.proxyCredentials))out.proxyCredentials=out.proxyCredentials.map(v=>({...v,type:'secret'}));
  for(const key of ['passphrase','clientSecret','refreshToken'])if(typeof out[key]==='string'&&out[key])out[key]={key,type:'secret',value:out[key]};
  return out;
 };return visit(input);
}
export function materializeNetwork(options){
 const copy=structuredClone(options),credentials=Object.fromEntries((copy.proxyCredentials||[]).map(v=>[v.key,v.value]));
 copy.proxyUsername=credentials.username;copy.proxyPassword=credentials.password;
 for(const c of copy.certificates||[])if(c.passphrase&&typeof c.passphrase==='object')c.passphrase=c.passphrase.value;
 return copy;
}
export const networkOf=item=>item?.['x-codex-api-client']?.network||{};
