from __future__ import annotations

from typing import Literal

Locale = Literal["en", "tr"]

SUPPORTED_LOCALES: tuple[Locale, ...] = ("en", "tr")


def resolve_locale(
    *,
    explicit: str | None = None,
    accept_language: str | None = None,
    default: Locale = "en",
) -> Locale:
    """Resolve UI/API locale ('en' or 'tr') from explicit param, Accept-Language, or default."""
    for candidate in (explicit, accept_language):
        if not candidate:
            continue
        for part in candidate.split(","):
            tag = part.split(";")[0].strip().lower()
            if tag.startswith("tr"):
                return "tr"
            if tag.startswith("en"):
                return "en"
    return default


_MESSAGES: dict[Locale, dict[str, str]] = {
    "en": {
        "err.bad_request": "Invalid request.",
        "err.not_found": "Record not found.",
        "err.conflict": "Resource conflict.",
        "err.pdf_parse_failed": "Could not extract text from PDF or file is corrupted.",
        "err.extraction_validation_failed": "Structured extraction failed contract validation.",
        "err.service_unavailable": "External or local model service is unreachable.",
        "err.not_implemented": "This feature is not enabled yet.",
        "err.validation": "Request parameters do not match the API contract.",
        "err.internal": "An unexpected server error occurred.",
        "err.no_files": "No PDF files provided ('files' field is empty).",
        "err.invalid_ingest": "Invalid ingestion request. Provide 'file_paths' list or multipart 'files'.",
        "err.style_source_not_found": "Specified file for style extraction was not found.",
        "err.no_style_texts": "At least one non-empty text or file must be provided to extract a style profile.",
        "err.paper_not_found": "Paper not found.",
        "err.job_not_found": "Job record not found.",
        "err.variable_not_found": "Variable not found.",
        "err.draft_not_found": "Draft not found.",
        "err.style_profile_not_found": "Style profile not found.",
        "err.audit_finding_not_found": "Audit finding not found.",
        "err.duplicate_paper": "This PDF file (matching SHA-256 digest) already exists in the paper pool.",
        "err.pdf_file_missing": "The local PDF file could not be found at its recorded path (it may have been moved or deleted).",
        "err.pdf_page_out_of_range": "Requested page number is outside the PDF page count.",
        "err.pdf_render_failed": "Failed to render the requested PDF page.",
        "job.queued": "Queued",
        "job.extracting_text": "Extracting PDF text and tables...",
        "job.parsing_llm": "Extracting variables, relationships, scales, and claims...",
        "job.indexing_vectors": "Indexing page-referenced chunks into LanceDB...",
        "job.completed": "Paper processing and vector indexing completed.",
        "gap.unstudied": "Indirectly connected via {common} shared neighbor variable(s), with no direct empirical test (0 studies).",
        "gap.understudied": "Both concepts appear in at least 2 papers and share {common} neighbor(s), yet only 1 direct study exists between them.",
        "style.summary": "Style: {tone} | Avg. sentence length: {avg_len} words | Passive voice: {passive_pct}% | Citation style: {citation_style}",
        "critic.unknown_paper": "Unknown Paper",
        "critic.citation_suggestion": "Suggested citation: ({author}, {year}{page_part})",
        "critic.page_part": ", p. {page}",
        "critic.contradiction": "The '{claimed}' claim in this sentence contradicts the '{observed}' finding in '{paper}' (p. {page}).",
        "critic.contradiction_suggestion": "Explicitly frame this divergence in the literature or cite differences in sample/methodology.",
        "critic.support_rel": "'{paper}' (p. {page}) supports this relationship in the '{observed}' direction.",
        "critic.missing_cite_rel": "Claim is supported by '{paper}' (p. {page}) in your local pool, but lacks an inline citation.",
        "critic.support_claim": "Semantically aligns with a core claim in '{paper}' (p. {page}).",
        "critic.missing_cite_claim": "Sentence aligns with a claim in '{paper}' (p. {page}), but an inline citation is missing.",
        "critic.support_chunk": "Supported by passage on p. {page} of '{paper}'.",
        "critic.unsupported": "This empirical claim could not be verified against validated relationships or claims in your local paper pool.",
        "critic.unsupported_suggestion": "Ingest the supporting paper into your pool, soften the claim's certainty, or add an explicit citation.",
        "critic.style_absolutist": "Absolutist phrasing ('{marker}') deviates from academic hedging norms.",
        "critic.style_hedge_with_list": "Consider hedging phrasing (e.g., {phrases}).",
        "critic.style_hedge_default": "Prefer cautious phrasing such as 'may', 'suggests', or 'indicates'.",
        "critic.style_sentence_len": "Average sentence length ({para_avg:.1f} words) diverges noticeably from your active '{profile}' profile ({prof_avg:.1f} words).",
        "critic.style_sentence_len_suggestion": "Consider adjusting sentence pacing closer to your profile baseline.",
        "critic.summary": "Audited {empirical} empirical sentence(s): {supported} supported, {contradicted} contradiction(s), and {unsupported} unsupported claim(s).",
    },
    "tr": {
        "err.bad_request": "Geçersiz istek.",
        "err.not_found": "Kayıt bulunamadı.",
        "err.conflict": "Kaynak çakışması.",
        "err.pdf_parse_failed": "PDF metni çıkarılamadı veya dosya bozuk.",
        "err.extraction_validation_failed": "Yapılandırılmış çıkarım sözleşme doğrulamasından geçemedi.",
        "err.service_unavailable": "Harici veya yerel model servisine erişilemiyor.",
        "err.not_implemented": "Bu özellik henüz aktif değil.",
        "err.validation": "İstek parametreleri sözleşmeye uygun değil.",
        "err.internal": "Beklenmeyen sunucu hatası oluştu.",
        "err.no_files": "Yüklenecek PDF dosyası gönderilmedi ('files' alanı boş).",
        "err.invalid_ingest": "Geçersiz ingestion isteği. 'file_paths' listesi veya multipart 'files' gönderilmelidir.",
        "err.style_source_not_found": "Stil çıkarımı için belirtilen dosya bulunamadı.",
        "err.no_style_texts": "Stil profili çıkarmak için en az bir boş olmayan metin veya dosya sağlanmalıdır.",
        "err.paper_not_found": "Makale bulunamadı.",
        "err.job_not_found": "İşlem kaydı bulunamadı.",
        "err.variable_not_found": "Değişken bulunamadı.",
        "err.draft_not_found": "Taslak bulunamadı.",
        "err.style_profile_not_found": "Stil profili bulunamadı.",
        "err.audit_finding_not_found": "Denetim bulgusu bulunamadı.",
        "err.duplicate_paper": "Bu PDF dosyası (aynı SHA-256 özetiyle) zaten havuzda mevcut.",
        "err.pdf_file_missing": "Yerel PDF dosyası kayıtlı konumda bulunamadı (taşınmış veya silinmiş olabilir).",
        "err.pdf_page_out_of_range": "İstenen sayfa numarası PDF sayfa aralığının dışında.",
        "err.pdf_render_failed": "İstenen PDF sayfası görüntülenemedi.",
        "job.queued": "Kuyruğa alındı",
        "job.extracting_text": "PDF metni ve tablolar çıkarılıyor...",
        "job.parsing_llm": "Değişkenler, ilişkiler, ölçekler ve iddialar çıkarılıyor...",
        "job.indexing_vectors": "Sayfa referanslı parçalar LanceDB vektör veritabanına indeksleniyor...",
        "job.completed": "Makale işleme ve indeksleme tamamlandı.",
        "gap.unstudied": "{common} ortak komşu değişken üzerinden dolaylı bağlantılı, ancak doğrudan ampirik test bulunmuyor (0 çalışma).",
        "gap.understudied": "Her iki kavram en az 2 makalede geçiyor ve {common} ortak komşuya sahip, ancak aralarında yalnızca 1 doğrudan çalışma bulunuyor.",
        "style.summary": "Stil: {tone} | Ort. cümle uzunluğu: {avg_len} kelime | Edilgenlik oranı: %{passive_pct} | Atıf biçimi: {citation_style}",
        "critic.unknown_paper": "Bilinmeyen Makale",
        "critic.citation_suggestion": "Önerilen atıf: ({author}, {year}{page_part})",
        "critic.page_part": ", s. {page}",
        "critic.contradiction": "Cümledeki '{claimed}' yönlü iddia, '{paper}' makalesindeki '{observed}' bulgusuyla (s. {page}) çelişmektedir.",
        "critic.contradiction_suggestion": "Bu çelişkiyi literatürdeki ayrışma olarak açıkça belirtin veya örneklem/yöntem farkına atıf yapın.",
        "critic.support_rel": "'{paper}' makalesi (s. {page}) bu ilişkiyi '{observed}' yönünde desteklemektedir.",
        "critic.missing_cite_rel": "İddia yerel havuzdaki '{paper}' (s. {page}) ile destekleniyor ancak cümlede satır içi atıf bulunamadı.",
        "critic.support_claim": "'{paper}' makalesindeki ana iddia (s. {page}) ile anlamca örtüşmektedir.",
        "critic.missing_cite_claim": "Cümle '{paper}' (s. {page}) iddiasıyla örtüşüyor ancak atıf eksik.",
        "critic.support_chunk": "'{paper}' makalesinin {page}. sayfasındaki pasajla desteklenmektedir.",
        "critic.unsupported": "Bu ampirik iddia yerel makale havuzundaki doğrulanmış ilişkiler veya iddialar arasında desteklenemedi.",
        "critic.unsupported_suggestion": "İlgili makaleyi PDF havuzuna ekleyin, ifadenin kesinliğini yumuşatın veya doğrudan kaynak atfı belirtin.",
        "critic.style_absolutist": "'{marker}' gibi kesinlik bildiren ifade akademik ihtiyatlılık (hedging) normundan sapıyor.",
        "critic.style_hedge_with_list": "Hedging ifadesi kullanın (ör. {phrases}).",
        "critic.style_hedge_default": "'may', 'indicates' veya 'göstermektedir' gibi ihtiyatlı ifadeler tercih edin.",
        "critic.style_sentence_len": "Paragraf ortalama cümle uzunluğu ({para_avg:.1f} kelime), aktif '{profile}' profilinizdeki ortalamadan ({prof_avg:.1f} kelime) belirgin biçimde sapıyor.",
        "critic.style_sentence_len_suggestion": "Cümle ritmini profilinizdeki ortalama uzunluğa yaklaştırmayı değerlendirin.",
        "critic.summary": "{empirical} ampirik cümleden {supported} desteklendi, {contradicted} çelişki ve {unsupported} desteksiz iddia saptandı.",
    },
}

CSV_HEADERS: dict[Locale, list[str]] = {
    "en": [
        "scale_id",
        "paper_id",
        "paper_title",
        "authors",
        "year",
        "variable_label",
        "scale_name",
        "original_authors",
        "original_year",
        "item_count",
        "cronbach_alpha",
        "composite_reliability",
        "ave",
        "response_format",
        "sample_size",
        "sample_population",
        "statistical_methods",
        "research_design",
        "page_number",
    ],
    "tr": [
        "olcek_id",
        "makale_id",
        "makale_basligi",
        "yazarlar",
        "yil",
        "degisken",
        "olcek_adi",
        "orijinal_yazarlar",
        "orijinal_yil",
        "madde_sayisi",
        "cronbach_alpha",
        "bilesik_guvenirlik_cr",
        "ave",
        "yanit_formati",
        "orneklem_buyuklugu",
        "orneklem_profili",
        "istatistiksel_yontemler",
        "arastirma_tasarimi",
        "sayfa_no",
    ],
}


def t(locale: Locale, key: str, **kwargs: object) -> str:
    table = _MESSAGES.get(locale, _MESSAGES["en"])
    template = table.get(key) or _MESSAGES["en"].get(key) or key
    return template.format(**kwargs) if kwargs else template
