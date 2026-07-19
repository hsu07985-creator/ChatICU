"""Response-schema base: snake_case 宣告、camelCase 輸出、可直讀 ORM。

B2(architecture-audit-2026-07-19)確立的序列化慣例:
- 新 endpoint 的 response payload 一律宣告 CamelModel 子類,
  用 ``Model.model_validate(orm_obj)`` + ``dump_camel()`` 取代手刻 dict。
- 既有 24 個 ``*_to_dict`` 手刻 serializer 依「改到哪遷到哪」原則分批換掉;
  首個示範:app/schemas/vital_sign.py + routers/vital_signs.py。
- 舊 schemas 裡直接宣告 camelCase 欄位 + from_attributes 的 *Response
  類(mw-2 dead code)不要模仿——ORM 是 snake_case,那條路序列化出來
  全是 None。
"""
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    def dump_camel(self) -> dict:
        """camelCase JSON-mode dict(datetime → ISO 字串),餵給 success_response。"""
        return self.model_dump(by_alias=True, mode="json")
