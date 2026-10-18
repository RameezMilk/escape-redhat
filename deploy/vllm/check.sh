#!/usr/bin/env bash
# Validate the vLLM endpoint before claiming integration:
#   1) model listing  2) one native tool call  3) an error → recovery round-trip  4) latency p50/p95 over N calls
# Usage (from the laptop through a tunnel, or on the GPU box):
#   ssh -N -L 8000:localhost:8000 <brev-instance>    # in another terminal
#   BASE_URL=http://localhost:8000/v1 API_KEY=$VLLM_API_KEY ./check.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8001/v1}"
API_KEY="${API_KEY:-${VLLM_API_KEY:-}}"
MODEL="${MODEL:-escape-nemotron}"
N="${N:-20}"
AUTH=(-H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json")

echo "== 1. GET /models"
curl -sf "${AUTH[@]}" "${BASE_URL}/models" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.data||[]).map(m=>m.id).join("\n"))})'

TOOLS='[{"type":"function","function":{"name":"check_in","description":"Record that a person reached the assembly point.","parameters":{"type":"object","properties":{"actor_id":{"type":"string","enum":["alex","maya","daniel"]}},"required":["actor_id"],"additionalProperties":false}}}]'

body() { # $1 = messages json
  cat <<JSON
{"model":"${MODEL}","messages":$1,"tools":${TOOLS},"tool_choice":"auto","temperature":0.6,"top_p":0.95,"max_tokens":512,"chat_template_kwargs":{"enable_thinking":false}}
JSON
}

echo "== 2. one tool call"
MSG='[{"role":"system","content":"You control simulated people in an evacuation exercise. Always respond with exactly one tool call."},{"role":"user","content":"Maya has reached the assembly point. Record it."}]'
RESP=$(curl -sf "${AUTH[@]}" "${BASE_URL}/chat/completions" -d "$(body "$MSG")")
echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).choices[0].message;console.log("tool_calls:",JSON.stringify(m.tool_calls));if(!m.tool_calls||!m.tool_calls.length){console.error("NO NATIVE TOOL CALL — check --tool-call-parser qwen3_coder / --enable-auto-tool-choice");process.exit(1)}})'

echo "== 3. error → recovery"
CALL_ID=$(echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).choices[0].message.tool_calls[0].id)})')
MSG2="[{\"role\":\"system\",\"content\":\"You control simulated people in an evacuation exercise. Always respond with exactly one tool call.\"},{\"role\":\"user\",\"content\":\"Record that the person who reached the assembly point checked in. It was Daniel.\"},{\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"${CALL_ID}\",\"type\":\"function\",\"function\":{\"name\":\"check_in\",\"arguments\":\"{\\\"actor_id\\\":\\\"maya\\\"}\"}}]},{\"role\":\"tool\",\"tool_call_id\":\"${CALL_ID}\",\"content\":\"{\\\"ok\\\":false,\\\"error\\\":{\\\"code\\\":\\\"OUT_OF_RANGE\\\",\\\"message\\\":\\\"maya is not at the assembly point\\\",\\\"hint\\\":\\\"The person at the assembly point is daniel.\\\"}}\"}]"
curl -sf "${AUTH[@]}" "${BASE_URL}/chat/completions" -d "$(body "$MSG2")" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).choices[0].message;console.log("after error:",JSON.stringify(m.tool_calls||m.content))})'

echo "== 4. latency over ${N} calls (sequential)"
node -e '
const [base,key,model,n,msg,tools]=process.argv.slice(1);
(async()=>{const t=[];for(let i=0;i<+n;i++){const s=Date.now();const r=await fetch(base+"/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model,messages:JSON.parse(msg),tools:JSON.parse(tools),tool_choice:"auto",temperature:0.6,top_p:0.95,max_tokens:512,chat_template_kwargs:{enable_thinking:false}})});await r.json();t.push(Date.now()-s)}
t.sort((a,b)=>a-b);const q=p=>t[Math.min(t.length-1,Math.ceil(p/100*t.length)-1)];console.log(`n=${t.length} p50=${q(50)}ms p95=${q(95)}ms min=${t[0]}ms max=${t[t.length-1]}ms`)})()' \
  "$BASE_URL" "$API_KEY" "$MODEL" "$N" "$MSG" "$TOOLS"

echo "== 5. restart check (run on the GPU box): docker restart nemotron-vllm && sleep 60 && rerun this script"
echo "OK — paste the outputs into MODEL_MANIFEST.md"
