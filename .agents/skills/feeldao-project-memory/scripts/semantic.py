"""Incremental local ONNX vectors and reciprocal-rank fusion."""
import hashlib
import json
import os
from pathlib import Path

_MODELS = {}


def model(config):
    from fastembed import TextEmbedding
    settings = config['model']
    key = (settings['name'], settings['path'])
    if key not in _MODELS:
        _MODELS[key] = TextEmbedding(model_name=settings['name'], specific_model_path=settings['path'],
                                   threads=settings.get('threads', 4), local_files_only=True)
    return _MODELS[key]


def token_count(config, text):
    tokenizer = model(config).model.tokenizer
    # Disable truncation only for measuring the chunk boundary.
    tokenizer.no_truncation()
    return len(tokenizer.encode(text).ids)


def chunk_id(chunk):
    return hashlib.sha256(chunk['text'].encode()).hexdigest()


def ensure_vectors(config, index):
    import numpy as np
    cache = Path(config['cache'])
    cache.mkdir(exist_ok=True, parents=True)
    meta_path, data_path = cache/'vectors.json', cache/'vectors.npy'
    metadata = json.loads(meta_path.read_text('utf-8')) if meta_path.exists() else {}
    signature = config['model']['name'] + '@' + config['model']['revision']
    ids = list(dict.fromkeys(chunk_id(c) for c in index['chunks']))
    old_vectors = {}
    if metadata.get('model') == signature and data_path.exists():
        matrix = np.load(data_path, allow_pickle=False)
        if len(matrix) == len(metadata.get('ids', [])):
            old_vectors = dict(zip(metadata['ids'], matrix))
    texts = {chunk_id(c): c['text'] for c in index['chunks']}
    missing = [key for key in ids if key not in old_vectors]
    if missing:
        for key, vector in zip(missing, model(config).embed([texts[key] for key in missing], batch_size=32)):
            old_vectors[key] = np.asarray(vector, dtype=np.float32)
    matrix = np.asarray([old_vectors[key] for key in ids], dtype=np.float32).reshape(-1, config['model']['dimensions'])
    with open(cache/'vectors.pending', 'wb') as stream:
        np.save(stream, matrix, allow_pickle=False)
    os.replace(cache/'vectors.pending', data_path)
    metadata = {'model': signature, 'ids': ids, 'new_vectors': len(missing), 'reused_vectors': len(ids)-len(missing), 'dimensions': config['model']['dimensions']}
    pending = meta_path.with_suffix('.pending')
    pending.write_text(json.dumps(metadata), encoding='utf-8')
    os.replace(pending, meta_path)
    return metadata


def search(config, index, query, lexical, top):
    import numpy as np
    if not query.strip():
        return []
    meta = json.loads((Path(config['cache'])/'vectors.json').read_text('utf-8'))
    matrix = np.load(Path(config['cache'])/'vectors.npy', allow_pickle=False)
    lookup = {key:i for i,key in enumerate(meta['ids'])}
    query_vector = np.asarray(list(model(config).query_embed([query]))[0], dtype=np.float32)
    query_vector /= max(float(np.linalg.norm(query_vector)), 1e-10)
    scores = matrix @ query_vector / np.maximum(np.linalg.norm(matrix, axis=1), 1e-10)
    ranked = sorted(range(len(index['chunks'])), key=lambda i:-float(scores[lookup[chunk_id(index['chunks'][i])]]))
    semantic_rank, seen = [], set()
    for i in ranked:
        identity = chunk_id(index['chunks'][i])
        if identity not in seen:
            semantic_rank.append(i)
            seen.add(identity)
        if len(semantic_rank)>=60:
            break
    def key(c):
        return (c['note'], c['line_start'])
    ranks, examples = {}, {}
    for rank, item in enumerate(lexical, 1):
        ranks[key(item)] = ranks.get(key(item), 0) + 1/(60+rank)
        examples[key(item)] = item
    for rank, i in enumerate(semantic_rank, 1):
        item = index['chunks'][i]
        similarity = float(scores[lookup[chunk_id(item)]])
        if similarity < .50:
            continue
        k = key(item)
        ranks[k] = ranks.get(k, 0) + 1/(60+rank)
        examples[k] = {**item, 'semantic_similarity': round(similarity, 5)}
    results, count, duplicates = [], {}, set()
    for k in sorted(ranks, key=lambda k:-ranks[k]):
        item = examples[k]
        # Same bytes in several branches share one passage with provenance.
        duplicate = (item['source_sha256'], item['line_start'],chunk_id(item))
        if count.get(item['note'], 0) >= 2 or duplicate in duplicates:
            continue
        count[item['note']] = count.get(item['note'], 0)+1
        duplicates.add(duplicate)
        results.append({**item, 'score': round(ranks[k], 7), 'retrieval': 'hybrid BM25+local-vector'})
        if len(results) >= top:
            break
    return results
