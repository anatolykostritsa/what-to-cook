import json
import sys

from argostranslate import package, translate


def get_translation():
    installed = translate.get_installed_languages()
    source = next((language for language in installed if language.code == "en"), None)
    target = next((language for language in installed if language.code == "ru"), None)
    if source and target:
        try:
            return source.get_translation(target)
        except Exception:
            pass

    print("Модель Argos EN→RU не установлена. Скачиваю один раз...", file=sys.stderr, flush=True)
    package.update_package_index()
    available = package.get_available_packages()
    candidate = next((item for item in available if item.from_code == "en" and item.to_code == "ru"), None)
    if candidate is None:
        raise RuntimeError("В каталоге Argos не найдена модель en→ru")

    model_path = candidate.download()
    package.install_from_path(model_path)

    installed = translate.get_installed_languages()
    source = next((language for language in installed if language.code == "en"), None)
    target = next((language for language in installed if language.code == "ru"), None)
    if not source or not target:
        raise RuntimeError("Модель EN→RU установилась, но языки не найдены")
    return source.get_translation(target)


def main():
    translator = get_translation()
    print("Argos EN→RU готов.", file=sys.stderr, flush=True)

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        request = json.loads(raw_line)
        request_id = request.get("id")
        texts = request.get("texts") or []
        try:
            translations = [translator.translate(str(text)) if text else "" for text in texts]
            response = {"id": request_id, "translations": translations}
        except Exception as error:
            response = {"id": request_id, "error": str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
