from typing import Literal, Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field

class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: Dict[str, Any]

class ContentPart(BaseModel):
    type: Literal["text", "image_url"]
    text: Optional[str] = None
    image_url: Optional[Dict[str, str]] = None

class UnifiedMessage(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: Union[str, List[ContentPart], None] = None
    name: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    tool_call_id: Optional[str] = None  # For tool role messages

    def to_openai(self) -> Dict[str, Any]:
        """Convert to OpenAI message format."""
        msg = {"role": self.role}
        
        if self.content:
            if isinstance(self.content, str):
                msg["content"] = self.content
            else:
                msg["content"] = [part.model_dump(exclude_none=True) for part in self.content]
        
        if self.name:
            msg["name"] = self.name
            
        if self.tool_calls:
            msg["tool_calls"] = [tc.model_dump() for tc in self.tool_calls]
            
        if self.tool_call_id:
            msg["tool_call_id"] = self.tool_call_id
            
        return msg

    def to_anthropic(self) -> Dict[str, Any]:
        """Convert to Anthropic message format."""
        # Note: Anthropic system messages are top-level parameters, not part of the messages list usually.
        # This converter assumes standard message format. System messages should be handled separately by the client.
        
        msg = {"role": self.role}
        
        if self.role == "tool":
            # Anthropic handles tool results differently (content array with type tool_result)
             return {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": self.tool_call_id,
                        "content": self.content
                    }
                ]
            }

        if self.content:
            if isinstance(self.content, str):
                msg["content"] = self.content
            else:
                # Convert image_url to Anthropic image format
                content_list = []
                for part in self.content:
                    if part.type == "text":
                        content_list.append({"type": "text", "text": part.text})
                    elif part.type == "image_url":
                        # Anthropic expects specific image block structure with base64 data
                        # Assuming image_url['url'] is data:image/jpeg;base64,... format
                        url = part.image_url['url']
                        if url.startswith("data:"):
                            media_type = url.split(";")[0].split(":")[1]
                            data = url.split(",")[1]
                            content_list.append({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": data
                                }
                            })
                msg["content"] = content_list

        if self.tool_calls:
            # Anthropic uses 'tool_use' blocks in content
            content_list = []
            if isinstance(msg.get("content"), str):
                 content_list.append({"type": "text", "text": msg["content"]})
            elif isinstance(msg.get("content"), list):
                content_list.extend(msg["content"])
            else:
                content_list = []
            
            for tc in self.tool_calls:
                content_list.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.function["name"],
                    "input": tc.function["arguments"] # Expecting arguments to be a dict for Anthropic
                })
            msg["content"] = content_list
            
        return msg
