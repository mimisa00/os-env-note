
# install vllm by nvidia cuda
```
uv pip install vllm --torch-backend=auto 

```



# run by docker gpt-oss:20b
```
docker run --gpus all \
    -p 8000:8000 \
    -v /path/to/models:/root/.cache/huggingface \
    --ipc=host \
    vllm/vllm-openai:latest \
    --model openai/gpt-oss-20b \
    --quantization awq \                  # 或 gptq / fp8 (依 Hugging Face 上的量化版本而定)
    --tensor-parallel-size 2 \            # 啟用 2 張 3060 合併運算
    --max-model-len 8192 \                # 將最大 Context 限制在 8k，節省 KV Cache 空間
    --gpu-memory-utilization 0.90         # 允許 vLLM 使用 90% 的顯存
```
