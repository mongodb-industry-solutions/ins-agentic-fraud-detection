"""
This is the function the application calls at query time. Kept faithful to the guide,
with two adaptations noted inline:
  * ``input_type`` is a parameter (guide §7): embed stored docs as "document" and
    search queries as "query" for best retrieval quality.
  * the shared module-level client is created lazily/guarded so a missing
    VOYAGE_API_KEY disables similarity gracefully instead of breaking import.
"""

try:
    from client import VoyageClient
except ImportError:
    from .client import VoyageClient

import logging
import os

from dotenv import load_dotenv
import voyageai

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')
load_dotenv()

# Default model; overridable via env so it stays in sync with the Atlas index dims
# (voyage-3.5 = 1024, voyage-3.5-lite = 1024 by default). See store.VECTOR_DIMENSIONS.
DEFAULT_MODEL_ID = os.getenv("VOYAGE_MODEL", "voyage-3.5")

# A single shared client instance. Created once at import time when a key is present;
# guarded so the app still starts (with similarity disabled) when it is not.
try:
    voyage_client = VoyageClient()._get_voyage_client() if os.getenv("VOYAGE_API_KEY") else None
except Exception as exc:  # noqa: BLE001
    logging.warning("Could not initialize Voyage client at import (%s).", exc)
    voyage_client = None


def get_embedding_model(model_id: str) -> voyageai.Client:
    return voyage_client


def get_embedding(text: str, model_id: str = DEFAULT_MODEL_ID,
                  input_type: str = "document") -> list:
    """Generate an embedding for the given text using Voyage Embeddings.

    Args:
        text:       The text to embed.
        model_id:   Voyage model id (default from VOYAGE_MODEL / "voyage-3.5").
        input_type: "document" for stored items, "query" for search queries.

    Returns a list[float] (length matches the model, 1024 for voyage-3.5), or None
    on invalid input / error / unavailable client.
    """
    if not text or not isinstance(text, str):
        logging.error("Invalid input. Please provide a valid text input.")
        return None

    global voyage_client
    if voyage_client is None:
        if not os.getenv("VOYAGE_API_KEY"):
            logging.warning("VOYAGE_API_KEY not set — embeddings unavailable.")
            return None
        voyage_client = VoyageClient()._get_voyage_client()

    try:
        # Create embeddings for the input text using the Voyage AI
        result = voyage_client.embed([text], model=model_id, input_type=input_type)
        return result.embeddings[0]
    except Exception as e:
        print(f"Error in get_embedding: {e}")
        return None


def get_embeddings(texts: list, model_id: str = DEFAULT_MODEL_ID,
                   input_type: str = "document") -> list:
    """Embed several texts in ONE Voyage call.

    Same contract as get_embedding (returns None rather than raising when the
    client is unavailable), but Voyage's embed() takes a list, so a backfill
    does one round trip per batch instead of one per document. Order is
    preserved: result[i] is the vector for texts[i].
    """
    if not texts or not isinstance(texts, list):
        logging.error("Invalid input. Please provide a non-empty list of texts.")
        return None
    if any((not text or not isinstance(text, str)) for text in texts):
        logging.error("Every item must be a non-empty string.")
        return None

    global voyage_client
    if voyage_client is None:
        if not os.getenv("VOYAGE_API_KEY"):
            logging.warning("VOYAGE_API_KEY not set — embeddings unavailable.")
            return None
        voyage_client = VoyageClient()._get_voyage_client()

    try:
        result = voyage_client.embed(texts, model=model_id, input_type=input_type)
        return result.embeddings
    except Exception as e:  # noqa: BLE001
        logging.error("Error in get_embeddings: %s", e)
        return None


if __name__ == '__main__':
    text = "Embed this text."
    embedding = get_embedding(text=text, model_id="voyage-3.5")
    print(len(embedding), embedding[:5])
