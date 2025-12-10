from abc import ABC, abstractmethod
from typing import Dict, Any, Type
from pydantic import BaseModel

class BaseTool(ABC):
    name: str
    description: str
    input_schema: Dict[str, Any]

    def to_openai_schema(self) -> Dict[str, Any]:
        """Convert to OpenAI tool definition format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema
            }
        }

    def to_anthropic_schema(self) -> Dict[str, Any]:
        """Convert to Anthropic tool definition format."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema
        }

    @abstractmethod
    async def execute(self, **kwargs) -> Any:
        """Execute the tool with the given arguments."""
        pass
