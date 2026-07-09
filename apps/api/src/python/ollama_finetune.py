#!/usr/bin/env python3
"""
LoRA fine-tuning script for invoice OCR extraction.

This script fine-tunes a base model using invoice correction logs
and prepares a GGUF/Modelfile for Ollama deployment.

Requirements:
  pip install transformers datasets peft trl accelerate bitsandbytes
  Optional for quantization/gguf conversion: llama.cpp
"""

import argparse
import json
import os
import sys
import subprocess
import torch
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description='Fine-tune Ollama model for invoice OCR')
    parser.add_argument('--base-model', required=True, help='Base model name or HuggingFace path')
    parser.add_argument('--ollama-model', required=True, help='Base Ollama model name for Modelfile')
    parser.add_argument('--dataset', required=True, help='Path to JSONL dataset file')
    parser.add_argument('--output-dir', required=True, help='Output directory for adapter and logs')
    parser.add_argument('--epochs', type=int, default=3, help='Number of training epochs')
    parser.add_argument('--batch-size', type=int, default=1, help='Per-device batch size')
    parser.add_argument('--learning-rate', type=float, default=2e-4, help='Learning rate')
    parser.add_argument('--lora-r', type=int, default=16, help='LoRA rank')
    parser.add_argument('--lora-alpha', type=int, default=32, help='LoRA alpha')
    parser.add_argument('--max-seq-length', type=int, default=1024, help='Max sequence length')
    return parser.parse_args()


def load_dataset(path: str):
    entries = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entries.append(json.loads(line))

    def format_entry(entry):
        return {
            'text': (
                f"<|system|>\nYou are an invoice data extraction assistant. Return valid JSON only.\n"
                f"<|user|>\n{entry['instruction']}\n\nInput:\n{entry['input']}\n"
                f"<|assistant|>\n{entry['output']}"
            ),
        }

    return [format_entry(e) for e in entries]


def run_finetune(args):
    try:
        from datasets import Dataset
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
        )
        from trl import SFTTrainer, SFTConfig
    except ImportError as e:
        print(f"Missing Python dependency: {e}")
        print("Install with: pip install transformers datasets peft trl accelerate bitsandbytes")
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    adapter_dir = output_dir / 'adapter'
    gguf_dir = output_dir / 'gguf'
    gguf_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading base model: {args.base_model}")
    has_cuda = torch.cuda.is_available()
    print(f"CUDA available: {has_cuda}")

    if has_cuda:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type='nf4',
            bnb_4bit_compute_dtype='float16',
            bnb_4bit_use_double_quant=True,
        )
        model_kwargs = {
            'quantization_config': bnb_config,
            'device_map': 'auto',
            'trust_remote_code': True,
        }
    else:
        model_kwargs = {
            'dtype': torch.float32,
            'trust_remote_code': True,
        }

    model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    if has_cuda:
        model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
        lora_dropout=0.05,
        bias='none',
        task_type='CAUSAL_LM',
    )
    model = get_peft_model(model, lora_config)

    print(f"Loading dataset: {args.dataset}")
    data = load_dataset(args.dataset)
    dataset = Dataset.from_list(data)

    training_args = SFTConfig(
        output_dir=str(output_dir / 'training'),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=args.learning_rate,
        logging_steps=10,
        save_strategy='epoch',
        fp16=has_cuda,
        bf16=False,
        optim='paged_adamw_8bit' if has_cuda else 'adamw_torch',
        report_to='none',
        dataloader_num_workers=0,
        dataset_text_field='text',
        max_length=args.max_seq_length,
        use_cpu=not has_cuda,
    )

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        args=training_args,
    )

    print('Starting training...')
    trainer.train()

    print(f'Saving adapter to {adapter_dir}')
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    ollama_model_name = args.ollama_model or args.base_model
    final_model_name = f'{ollama_model_name}-invoice-ft'
    modelfile_path = output_dir / 'Modelfile'
    gguf_path = output_dir / 'model.gguf'

    # Merge adapter with base model and export to GGUF for Ollama
    merged_dir = output_dir / 'merged'
    print(f'Merging adapter with base model into {merged_dir}...')
    try:
        base_model = AutoModelForCausalLM.from_pretrained(
            args.base_model,
            dtype=torch.float32,
            trust_remote_code=True,
        )
        base_tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
        merged_model = PeftModel.from_pretrained(base_model, str(adapter_dir))
        merged_model = merged_model.merge_and_unload()
        merged_dir.mkdir(parents=True, exist_ok=True)
        merged_model.save_pretrained(merged_dir)
        base_tokenizer.save_pretrained(merged_dir)
        print(f'Merged model saved to {merged_dir}')
    except Exception as e:
        print(f'Failed to merge adapter: {e}')
        sys.exit(1)

    print(f'Converting merged model to GGUF at {gguf_path}...')
    llama_cpp_dir = os.environ.get('LLAMA_CPP_DIR', '/opt/llama.cpp')
    convert_script = Path(llama_cpp_dir) / 'convert_hf_to_gguf.py'
    if not convert_script.exists():
        print(f'convert_hf_to_gguf.py not found at {convert_script}. Set LLAMA_CPP_DIR env var.')
        sys.exit(1)
    try:
        subprocess.run(
            [
                sys.executable,
                str(convert_script),
                str(merged_dir),
                '--outfile',
                str(gguf_path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        print(f'GGUF model saved to {gguf_path}')
    except subprocess.CalledProcessError as e:
        print(f'Failed to convert to GGUF: {e}')
        print(f'stdout: {e.stdout}')
        print(f'stderr: {e.stderr}')
        sys.exit(1)

    # Ensure Ollama server (running as non-root) can read the GGUF and Modelfile
    os.chmod(gguf_path, 0o644)
    os.chmod(modelfile_path, 0o644)

    system_prompt = '"""You are an invoice data extraction assistant for Madison 88. Return valid JSON only."""'
    modelfile_content = f"""FROM {gguf_path}

PARAMETER temperature 0.1
PARAMETER stop <|user|>
PARAMETER stop <|assistant|>

SYSTEM {system_prompt}
"""
    modelfile_path.write_text(modelfile_content, encoding='utf-8')
    print(f'Created Modelfile at {modelfile_path}')

    print('\nTo create the Ollama model, run:')
    print(f'  ollama create {final_model_name} -f {modelfile_path}')
    print(f'  ollama create {final_model_name} -f {modelfile_path}', file=open(output_dir / 'create_ollama_model.sh', 'w'))

    print(f'Creating Ollama model {final_model_name}...')
    try:
        subprocess.run(
            ['ollama', 'create', final_model_name, '-f', str(modelfile_path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        print(f'Successfully created Ollama model {final_model_name}')
    except subprocess.CalledProcessError as e:
        print(f'Failed to create Ollama model: {e}')
        print(f'stdout: {e.stdout}')
        print(f'stderr: {e.stderr}')
        sys.exit(1)
    except FileNotFoundError:
        print('ollama command not found. Please install Ollama and ensure it is in PATH.')
        sys.exit(1)


if __name__ == '__main__':
    args = parse_args()
    run_finetune(args)
