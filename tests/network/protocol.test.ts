import {describe,expect,it} from 'vitest';
import {parseClientMessage,ProtocolError} from '../../src/network/protocol';
const encode=(value:unknown)=>JSON.stringify(value);
describe('realtime client intent schemas',()=>{
 it('accepts the exact bounded message variants',()=>{
  const messages=[
   {v:2,type:'create',requestId:'create-1'}, {v:2,type:'join',requestId:'join-1',code:'ABC234'},
   {v:2,type:'resume',requestId:'resume-1',token:'a'.repeat(32)},
   {v:2,type:'compatible',seq:1,rulesVersion:2,mapId:'maze-01',mapVersion:2},
   {v:2,type:'ready',seq:2},{v:2,type:'fire',seq:3,matchId:'m_one'},
   {v:2,type:'input',seq:4,matchId:'m_one',shotId:1,mask:15},
   {v:2,type:'rematch',seq:5,matchId:'m_one'},{v:2,type:'leave',seq:6},{v:2,type:'ping',seq:7,clientTimeMs:123.5},
  ];
  for(const message of messages)expect(parseClientMessage(encode(message))).toEqual(message);
 });
 it('rejects identity/position/winner fields, unknown keys and malformed numeric intent',()=>{
  const input={v:2,type:'input',seq:1,matchId:'m_one',shotId:1,mask:1};
  for(const field of ['playerId','position','velocity','heading','winner'])expect(()=>parseClientMessage(encode({...input,[field]:'p2'}))).toThrow(ProtocolError);
  for(const mask of [-1,16,1.5,null,'1'])expect(()=>parseClientMessage(encode({...input,mask}))).toThrow();
  for(const seq of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'1'])expect(()=>parseClientMessage(encode({...input,seq}))).toThrow();
  for(const raw of ['not json','null','[]','42','{"v":2,"type":"ping","seq":1,"clientTimeMs":1e999}'])expect(()=>parseClientMessage(raw)).toThrow();
  expect(()=>parseClientMessage(encode({...input,v:1}))).toThrow();
  expect(()=>parseClientMessage(encode({v:2,type:'fire',seq:1}))).toThrow();
 });
 it('enforces UTF-8 payload and string bounds before accepting requests',()=>{
  expect(()=>parseClientMessage(' '.repeat(1025))).toThrow('size limit');
  expect(()=>parseClientMessage(encode({v:2,type:'create',requestId:'x'.repeat(65)}))).toThrow();
  expect(()=>parseClientMessage(encode({v:2,type:'join',requestId:'join',code:'BAD'}))).toThrow();
  expect(()=>parseClientMessage(encode({v:2,type:'resume',requestId:'resume',token:'secret'}))).toThrow();
 });
});
