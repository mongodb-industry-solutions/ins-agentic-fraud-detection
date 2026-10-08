"""Voyage AI embeddings — client, getters, and MongoDB-integrated embedder.

Mirrors the structure of VOYAGE_EMBEDDINGS_GUIDE.md:
    client.py            -> VoyageClient          (SDK client wrapper)
    getters.py           -> get_embedding()        (main entry point)
    voyage_embeddings.py -> VoyageEmbeddings        (class + bulk collection embedding)
"""

from .client import VoyageClient
from .getters import get_embedding, get_embedding_model
from .voyage_embeddings import VoyageEmbeddings

__all__ = [
    "VoyageClient",
    "get_embedding",
    "get_embedding_model",
    "VoyageEmbeddings",
]
