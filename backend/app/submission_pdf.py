"""Offline PDF layout over editable page specifications, with fail-closed fit checks."""
from __future__ import annotations

import io
from html import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader, PdfWriter

INK = colors.HexColor('#172e40')
TEAL = colors.HexColor('#167c80')
MUTED = colors.HexColor('#516472')
PALE = colors.HexColor('#edf4f4')


def clean(text):
    return str(text).replace('\u2011', '-').replace('–', '-').replace('—', '-')


def number(value, digits=6):
    if isinstance(value, bool):
        return 'да' if value else 'нет'
    if isinstance(value, (int, float)):
        return f'{value:.{digits}f}'.rstrip('0').rstrip('.').replace('.', ',')
    return str(value)


def render_pdf(pages, identity, font_path, title, landscape=False):
    """No timestamps/random IDs; raises instead of clipping or shrinking content."""
    pdfmetrics.registerFont(TTFont('Kosmos', str(font_path)))
    pdfmetrics.registerFontFamily('Kosmos', normal='Kosmos', bold='Kosmos', italic='Kosmos', boldItalic='Kosmos')
    width, height = (960, 540) if landscape else (595.276, 841.89)
    margin, bottom = (42, 72) if landscape else (43, 79)
    output = io.BytesIO()
    canvas = Canvas(output, pagesize=(width, height), invariant=1, pageCompression=1)
    canvas.setTitle(title)
    canvas.setAuthor('Портфель космических сервисов / предложение команды')
    canvas.setSubject(identity['submission_id'])
    layouts = []
    for index, page in enumerate(pages, 1):
        y = height - margin
        canvas.setFillColor(TEAL)
        canvas.setFont('Kosmos', 10 if landscape else 9)
        canvas.drawString(margin, y, 'КОСМОС КАК ИНФРАСТРУКТУРА / КЕЙС 1.1')
        y -= 26 if landscape else 25

        def para(text, size, gap=8, color=INK):
            nonlocal y
            style = ParagraphStyle('body', fontName='Kosmos', fontSize=size, leading=size*1.34,
                                   textColor=color, splitLongWords=True)
            p = Paragraph(escape(clean(text)).replace('\n', '<br/>'), style)
            _, ph = p.wrap(width-2*margin, height)
            if y-ph < bottom:
                raise ValueError(f'{title} page {index}: text overflow {y-ph:.1f} < {bottom}: {str(text)[:90]}')
            p.drawOn(canvas, margin, y-ph)
            y -= ph+gap

        para(page['title'], 30 if landscape else 21, 16, INK)
        for block in page['blocks']:
            kind = block['kind']
            if kind == 'p':
                para(block['text'], block.get('size', 18 if landscape else 10.5), block.get('gap', 9))
            elif kind == 'h':
                para(block['text'], 20 if landscape else 12.3, 6, TEAL)
            elif kind == 'table':
                size = block.get('size', 17 if landscape else 9.1)
                style = ParagraphStyle('cell', fontName='Kosmos', fontSize=size, leading=size*1.28, textColor=INK)
                data = [[Paragraph(escape(clean(c)), style) for c in row] for row in [block['headers'], *block['rows']]]
                weights = block.get('widths', [1]*len(data[0]))
                table = Table(data, colWidths=[(width-2*margin)*v/sum(weights) for v in weights])
                table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE), ('VALIGN',(0,0),(-1,-1),'TOP'),
                    ('LINEBELOW',(0,0),(-1,0),.7,TEAL), ('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor('#cddadd')),
                    ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
                    ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
                _, th = table.wrap(width-2*margin,height)
                if y-th < bottom:
                    raise ValueError(f'{title} page {index}: table overflow {y-th:.1f} < {bottom}')
                table.drawOn(canvas,margin,y-th); y -= th+12
            elif kind == 'bars':
                # Native PDF data chart; the exact data also lives in content.json/CSV.
                labels, values = block['labels'], block['values']
                row_h = 35 if landscape else 28
                label_w = 155 if landscape else 118
                h = row_h*len(values)+32
                if y-h < bottom:
                    raise ValueError(f'{title} page {index}: chart overflow')
                maximum = max([*values, block.get('limit', 0)])*1.08
                plot_x, plot_w = margin+label_w, width-2*margin-label_w-62
                size = 17 if landscape else 10
                for j,(label,value) in enumerate(zip(labels,values)):
                    by = y-(j+1)*row_h
                    canvas.setFillColor(INK);canvas.setFont('Kosmos',size);canvas.drawString(margin,by+5,clean(label))
                    canvas.setFillColor(TEAL);canvas.rect(plot_x,by,plot_w*value/maximum,17,fill=1,stroke=0)
                    canvas.setFillColor(INK);canvas.drawString(plot_x+plot_w*value/maximum+7,by+4,number(value))
                if block.get('limit'):
                    lx=plot_x+plot_w*block['limit']/maximum
                    canvas.setStrokeColor(colors.HexColor('#a04c38'));canvas.setDash(3,2)
                    canvas.line(lx,y+2,lx,y-row_h*len(values)-2);canvas.setDash()
                y-=h
                para(block['caption'], 13 if landscape else 8.7, 9, MUTED)
            elif kind == 'link':
                style=ParagraphStyle('link',fontName='Kosmos',fontSize=block.get('size',8.5),leading=11.5,textColor=TEAL)
                text=f'<link href="{escape(block["uri"],quote=True)}" color="#167c80">{escape(clean(block["text"]))}</link>'
                p=Paragraph(text,style);_,ph=p.wrap(width-2*margin,height)
                if y-ph<bottom: raise ValueError(f'{title} page {index}: link overflow')
                p.drawOn(canvas,margin,y-ph);y-=ph+5
            else:
                raise ValueError('Unknown page block: '+kind)
        layouts.append({'page':index,'title':page['title'],'bottom_content_y':round(y,2),'min_y':bottom})
        canvas.setStrokeColor(TEAL);canvas.line(margin,63,width-margin,63)
        canvas.setFillColor(MUTED);canvas.setFont('Kosmos',6.7 if not landscape else 7)
        for offset,line in enumerate([
            'M5 / '+identity['renderer_version']+' / выпуск '+identity['submission_id'],
            'Input fingerprint: '+identity['input_fingerprint'],
            'Source set SHA-256: '+identity['source_set_sha256'],
        ]): canvas.drawString(margin,51-offset*10,line)
        canvas.drawRightString(width-margin,18,f'{index} / {len(pages)}')
        canvas.showPage()
    canvas.save()
    # Full per-source hashes are embedded in each PDF, in addition to visible IDs.
    from .contracts import canonical_json
    reader=PdfReader(io.BytesIO(output.getvalue()))
    writer=PdfWriter();writer.clone_document_from_reader(reader)
    writer.add_attachment('identity.json',canonical_json(identity))
    final=io.BytesIO();writer.write(final)
    result=final.getvalue()
    if len(PdfReader(io.BytesIO(result)).pages)!=len(pages): raise ValueError('PDF page count mismatch')
    return result,layouts
