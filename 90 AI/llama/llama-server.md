# 此文件解釋 docker-compose.yml llama-server 啟動參數作用
以下依功能分組整理方便對照:

## GPU 資源分配

| 參數 | 作用 | 詳細解釋連結 |
|---|---|---|
| `-ts 13,12` | tensor-split,決定模型權重與 KV cache 按此比例分配到各張 GPU(這裡是 GPU0:GPU1 = 13:12,因為兩卡各自剩餘 VRAM 不同,調這個比例來平衡負載) | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `-ngl 99` | number of GPU layers,要卸載到 GPU 的模型層數。99 是刻意設超過模型實際層數,代表「全部層都上 GPU」 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `-fa auto` | Flash Attention 開關。`auto` 讓 llama.cpp 自行判斷硬體/量化組合是否支援,能用就用融合(fused)的高效 kernel | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |

## 主模型 KV Cache

| 參數 | 作用 | 詳細解釋連結 |
|---|---|---|
| `--ctx-size 131072` | 主模型的 context window 上限(這裡是 128K token) | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--cache-type-k q4_0` | 主模型 KV cache 中 Key 的量化精度 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--cache-type-v q4_0` | 主模型 KV cache 中 Value 的量化精度。**這裡刻意跟 K 用同一種類型(對稱)**,是因為前面測出非對稱組合(如 q8_0/q5_1)會讓 fused Flash Attention kernel 失效、掉到極慢的 fallback 路徑 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |

## 投機解碼(Speculative Decoding / MTP)

| 參數 | 作用 | 詳細解釋連結 |
|---|---|---|
| `--spec-type draft-mtp` | 指定用 MTP(Multi-Token Prediction)模式做投機解碼——用模型自帶的 MTP head 產生草稿 token,而不是額外載入一顆獨立的小型 draft model | [docs/speculative.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| `--spec-draft-n-max 2` | 每一輪最多草擬(draft)幾個 token 讓主模型一次驗證 | [docs/speculative.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| `--spec-draft-type-k q4_0` | 草稿(draft)模型自己的 KV cache Key 精度。因為草稿結果一定會被主模型驗證,精度低只影響命中率/加速比,**不影響最終輸出正確性**,所以可以放心用最低精度省記憶體 | [docs/speculative.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| `--spec-draft-type-v q4_0` | 同上,草稿模型 KV cache 的 Value 精度 | [docs/speculative.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |

## 推理併發

| 參數 | 作用 | 詳細解釋連結 |
|---|---|---|
| `-np 1` | 平行 slot 數,也就是同時能處理幾個獨立對話/請求。設 1 代表整個 context 空間都給單一使用者獨佔,不做多工分流 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |

## 取樣參數(Sampling)

| 參數 | 作用 | 詳細解釋連結 |
|---|---|---|
| `--temp 1.0` | 溫度,控制輸出的隨機性。越高越發散,越低越保守/決定性 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--top-p 0.95` | nucleus sampling,只從累積機率達 95% 的候選 token 中取樣 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--top-k 20` | 只從機率最高的前 20 個 token 中取樣 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--min-p 0.0` | 過濾掉機率低於「最高機率 × min-p」的 token。設 0 代表不啟用這個過濾 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--repeat-penalty 1.0` | 對已出現過的 token 施加懲罰,降低重複機率。1.0 代表不懲罰(關閉) | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--presence-penalty 0.0` | 對「已出現過的 token」做固定額度扣分(跟 repeat-penalty 機制不同,是加減而非乘法)。0 代表關閉 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |

## 模板 / 其他

| 參數 | 作用 | 詳細解釋連結 |
|---|---|---|
| `--chat-template-kwargs '{"reasoning_effort":"xhigh"}'` | 傳遞額外參數給 Jinja chat template,這裡是設定 Qwen3 系列 hybrid-reasoning 模型的思考強度為最高等級(xhigh),模型會花更多 token 在內部推理鏈上 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| `--jinja` | 啟用 Jinja2 chat template 引擎,取代 llama.cpp 內建的簡化模板。要支援 Qwen3 這類需要 tool-calling / reasoning 格式(`<think>` 標籤等)的官方模板,必須開這個 | [server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |

---

