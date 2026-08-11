
# GPT-OSS-20B | Ampere Arch | BF16
python3 -m vllm.entrypoints.openai.api_server \
      --model openai/gpt-oss-20b              \
      --pipeline-parallel-size 3              \
      --tensor-parallel-size 1                \
      --distributed-executor-backend ray      \
      --host 0.0.0.0                          \
      --port 8000                             \
      --gpu-memory-utilization 0.9            \
      --max-model-len  131070                 \
      --enable-auto-tool-choice               \
      --tool-call-parser openai               \
      --dtype float16                         \
      --reasoning-parser openai_gptoss

# Qwen3-30B-A3B | 
python3 -m vllm.entrypoints.openai.api_server \
      --model Qwen/Qwen3-30B-A3B \
      --dtype float16 \
      --pipeline-parallel-size 3 \
      --tensor-parallel-size 1 \
      --distributed-executor-backend ray \
      --host 0.0.0.0 \
      --port 8000 \
      --gpu-memory-utilization 0.9 \
      --hf-overrides '{"rope_scaling": {"rope_type":"yarn","factor":4.0,"original_max_position_embeddings":32768}}' \
      --max-model-len 65535 \
      --enforce-eager \
      --quantization awq \
      --enable-auto-tool-choice \
      --tool-call-parser qwen3_coder \
      --reasoning-parser qwen3       
