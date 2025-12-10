from abc import ABC, abstractmethod
from typing import List, AsyncGenerator, Any, Optional
from .messages import UnifiedMessage
from .base_tool import BaseTool

class LLMClient(ABC):
    @abstractmethod
    async def chat_completion(
        self, 
        messages: List[UnifiedMessage], 
        tools: Optional[List[BaseTool]] = None,
        session_id: Optional[str] = None,
        **kwargs
    ) -> UnifiedMessage:
        """Get a complete response from the LLM."""
        pass

    @abstractmethod
    async def stream_chat_completion(
        self, 
        messages: List[UnifiedMessage], 
        tools: Optional[List[BaseTool]] = None,
        **kwargs
    ) -> AsyncGenerator[Any, None]:
        """Stream the response from the LLM."""
        pass
    
    async def check_health(self, model: Optional[str] = None) -> bool:
        """Check if the LLM is reachable and working."""
        try:
            # Simple ping message
            msg = UnifiedMessage(role="user", content="ping")
            kwargs = {"max_tokens": 5}
            if model:
                kwargs["model"] = model
            await self.chat_completion([msg], **kwargs)
            return True
        except Exception:
            return False
