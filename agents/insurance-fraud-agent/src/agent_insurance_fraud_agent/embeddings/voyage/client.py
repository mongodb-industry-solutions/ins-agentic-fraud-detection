import os

import voyageai
from dotenv import load_dotenv

load_dotenv()


class VoyageClient:
    """Thin wrapper around the Voyage AI SDK client."""

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("VOYAGE_API_KEY")

    def _get_voyage_client(self) -> voyageai.Client:
        return voyageai.Client(api_key=self.api_key)

    def __del__(self):
        pass  # Voyage AI client has no explicit close
