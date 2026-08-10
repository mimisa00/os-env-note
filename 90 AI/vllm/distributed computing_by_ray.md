https://docs.ray.io/en/latest/index.html#

# vllm 運作分散式並行架構 | Distributed Parallelism


## 模型並行 （Model Parallelism）
當單張 GPU vRam 裝不下整個模型時，需要將模型的不同層或模組拆分到 數張 GPU 上
- 管道並行（Pipeline Parallelism / DeepSpeed / vLLM）
  - 做法：將模型的 Layer（層）順序切成 3 份。例如：
    - 主機 A - GPU 0：處理第 1 ～ 10 層
    - 主機 A - GPU 1：處理第 11 ～ 20 層
    - 主機 B - GPU 2：處理第 21 ～ 30 層
  - 資料流：資料先在主機 A 內部的 GPU 0 算完，傳給 GPU 1，最後透過跨網路（TCP/IP / Ethernet / InfiniBand）傳給主機 B 的 GPU 2。
- 張量並行（Tensor Parallelism）
  - 做法：將每一層矩陣計算拆分給多張 GPU 同時計算。
  - 建議：張量並行對 GPU 之間的頻寬要求極高（通常需要 NVLink），跨主機傳輸容易成為瓶頸。因此建議將張量並行留在同一台主機（主機 A 的 2 張 GPU）內部，跨主機則搭配管道並行。
 
## 資料並行（Data Parallelism）
如果單張 GPU 顯存已經裝得下整個模型，只是想加快訓練或推理速度：
- 做法：多張 GPU 各載入一份完整的模型副本
- 機制：每張 GPU 處理不同的批次資料（Batch），計算完後透過跨主機網路同步梯度（Gradient Synchronization）或進行負載均衡（Load Balancing）。

## 常見實現工具與框架
- 大語言模型推理 (LLM Inference)：
  - vLLM / Ray：可設定 --pipeline-parallel-size 3 或跨節點集群設置，自動將模型分佈在多台主機與多卡上執行。
  - Ollama (搭配 llama.cpp 集群) 或 RPC 部署。
- 模型訓練與微調 (Training / Fine-tuning)：
  - PyTorch Distributed (torchrun / DDP / FSDP)：支援跨節點（Multi-node）分散式執行。
  - DeepSpeed / Hugging Face Accelerate：設定配置文件（config）即可支援跨主機 多 卡切分（ZeRO-3 模式非常適合跨主機顯存共享）。
 
## 實務注意事項
- 網路頻寬是最大瓶頸：同主機內的 GPU 是走 PCIe 或 NVLink，傳輸極快；但跨主機（主機 A $\to$ 主機 B）走的是乙太網路。建議兩台主機之間至少配備 10GbE（萬兆網卡） 或 InfiniBand，否則跨主機資料傳輸時間會拖慢整體速度。
- 網路設定：兩台主機之間必須能透過 IP 互相連通，且需要開放對應的通信連接埠（例如 PyTorch 預設的 Master Port）。


### 以下透過 vllm Ray 演示如何架構
在 vLLM 中要實現跨多台主機、共 N 張 GPU 執行大語言模型（LLM），最關鍵的核心是利用 Ray 作為跨節點（Multi-node）的底層叢集（Cluster）管理工具。
由於多張卡分散在不同台機器（例如：主機 A 2 張 GPU，主機 B 1 張 GPU），建議採用 管道並行（Pipeline Parallelism, PP = 3），這樣可以將網路傳輸量降到最低（跨機器只需傳入/傳出 Activation Tensor），避免跨機器走乙太網路時遭遇張量並行（TP）的頻寬瓶頸。

跨主機 3 卡配置步驟 (vLLM + Ray)

假設配置如下：
- 主機 A (Master/Head Node)：IP 192.168.1.100，擁有 2 張 GPU (CUDA_VISIBLE_DEVICES=0,1)
- 主機 B (Worker Node)：IP 192.168.1.101，擁有 1 張 GPU (CUDA_VISIBLE_DEVICES=0)

1. 準備環境與網路設定
- 確保兩台主機均安裝相同版本的 Python、CUDA、PyTorch、vLLM 與 Ray
  ```
  pip install vllm ray
  ```
- 確保主機 B 能直接 ping 通主機 A，且主機 A 開放 Ray 預設的 Port 6379。

2. 在主機 A 啟動 Ray Head 節點
- 在主機 A（Master）終端機執行，啟動控制中心：
  ```
  ray start --head --port=6379 --node-ip-address='192.168.250.159'
  ```
3. 在主機 B 加入 Ray 叢集
- 在主機 B（Worker）終端機執行，將主機 B 的 1 張 GPU 加入主機 A 的叢集：
  ```
  ray start --address='192.168.1.100:6379'
  ```
- 驗證叢集狀態：在主機 A 輸入 ray status，應看到共有 2 個 Nodes、3 張 GPUs。
4. 在主機 A 啟動 vLLM API Server
- 在主機 A 執行 vLLM 命令，設定 --pipeline-parallel-size 3（PP=3）：
  ```
  ray stop --force
  pkill -9 -f vllm
  pkill -9 -f ray
  rm -rf /tmp/ray
  ```
  ```
  #關閉 IPV6 | 網卡名稱需替換成實際網卡
  export GLOO_SOCKET_IFNAME=eth0
  export NCCL_SOCKET_IFNAME=eth0
  export TP_SOCKET_IFNAME=eth0
  export GLIBCXX_USE_CXX11_ABI=1
  #HF 設定值
  export HF_HOME=/path
  export HF_TOKEN=hf_token
  # DEBUG
  export NCCL_DEBUG=INFO
  export VLLM_LOGGING_LEVEL=INFO # 開啟詳細 Log

  ```
  
  ```
  python3 -m vllm.entrypoints.openai.api_server \
      --model openai/gpt-oss-20b              \
      --pipeline-parallel-size 3              \
      --tensor-parallel-size 1                \
      --distributed-executor-backend ray      \
      --host 0.0.0.0                          \
      --port 8000                             \
      --gpu-memory-utilization 0.9            \
      --max-model-len  131072                 \
      --enable-auto-tool-choice               \
      --tool-call-parser openai               \
      --reasoning-parser openai_gptoss
  ```
  or
  ```
  python3 -m vllm.entrypoints.openai.api_server \
      --model QuixiAI/Qwen3-30B-A3B-AWQ \
      --dtype float16 \
      --pipeline-parallel-size 3 \
      --tensor-parallel-size 1 \
      --distributed-executor-backend ray \
      --host 0.0.0.0 \
      --port 8000 \
      --gpu-memory-utilization 0.9 \
	  --hf-overrides '{"rope_scaling": {"rope_type":"yarn","factor":4.0,"original_max_position_embeddings":32768}}'
      --max-model-len 131072 \
      --enforce-eager \
      --quantization awq \
      --enable-auto-tool-choice \
      --tool-call-parser qwen3_coder \
      --reasoning-parser qwen3 
  ```
### 重要參數解析與調優建議
- --pipeline-parallel-size 3 (PP=3)：
將模型依 Layer 均分切成 3 份，分別放入主機 A 的 GPU 0、GPU 1 以及主機 B 的 GPU 0。跨機器通訊僅在 Layer 的邊界進行，極度適合跨主機連線。
- --tensor-parallel-size 1 (TP=1)：
強烈不建議跨主機開啟 TP（例如 TP=3），因為 TP 在每一次 Attention 計算都需跨節點同步（All-Reduce），若沒有 NVLink-over-Fabric 或 100Gbps+ InfiniBand，推論速度會極慢。
- 混合並行 (若未來擴充機器)：
若主機 A 有 2 卡、主機 B 有 2 卡（共 4 卡），最佳做法是 TP=2, PP=2：同機器內走高頻寬 TP=2，跨機器走 PP=2。
- --gpu-memory-utilization：
跨主機配置時，預設會佔用 90% 顯存。若出現 OOM，可適度降低（如 --gpu-memory-utilization 0.85）。
- 所有主機的 python 版本及 vllm 版本必需一致

