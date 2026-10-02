#!/usr/bin/env python3
"""
parse-jetpack-sql.py

Parses WordPress SQL table dumps extracted from Jetpack backup:
- wp_133379588_posts.sql
- wp_133379588_terms.sql
- wp_133379588_term_taxonomy.sql
- wp_133379588_term_relationships.sql
- wp_133379588_users.sql
- wp_133379588_postmeta.sql

Extracts all `yada_wiki` posts, along with blog posts and pages, resolves their
taxonomies, author display names, and featured thumbnails, and outputs:
- /tmp/wp_parsed_articles.json
"""

import sys
import os
import re
import json

SQL_DIR = '/tmp/wp_backup_sql/sql'
OUTPUT_JSON = '/tmp/wp_parsed_articles.json'

def parse_sql_values(val_str):
    """
    Parses a single MySQL INSERT tuple string into Python values.
    Handles escaped quotes, newlines, backslashes, numbers, and NULL.
    """
    tokens = []
    i = 0
    n = len(val_str)
    while i < n:
        while i < n and (val_str[i] == ' ' or val_str[i] == ','):
            i += 1
        if i >= n:
            break
        if val_str[i] == "'":
            i += 1
            buf = []
            while i < n:
                c = val_str[i]
                if c == '\\':
                    if i + 1 < n:
                        next_c = val_str[i+1]
                        if next_c == 'n': buf.append('\n')
                        elif next_c == 'r': buf.append('\r')
                        elif next_c == 't': buf.append('\t')
                        elif next_c == '\\': buf.append('\\')
                        elif next_c == "'": buf.append("'")
                        elif next_c == '"': buf.append('"')
                        elif next_c == '0': buf.append('\0')
                        else: buf.append(next_c)
                        i += 2
                        continue
                elif c == "'":
                    if i + 1 < n and val_str[i+1] == "'":
                        buf.append("'")
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                buf.append(c)
                i += 1
            tokens.append(''.join(buf))
        else:
            buf = []
            while i < n and val_str[i] not in (',', ')'):
                buf.append(val_str[i])
                i += 1
            val = ''.join(buf).strip()
            if val == 'NULL':
                tokens.append(None)
            elif val.isdigit():
                tokens.append(int(val))
            else:
                tokens.append(val)
        while i < n and (val_str[i] == ' ' or val_str[i] == ','):
            i += 1
    return tokens

def main():
    print(f"[Parser] Loading tables from {SQL_DIR}...")

    # 1. Parse Users
    user_names = {}
    users_file = os.path.join(SQL_DIR, 'wp_133379588_users.sql')
    if os.path.exists(users_file):
        with open(users_file, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if line.startswith('INSERT INTO `wp_133379588_users`'):
                    m = re.search(r'VALUES \((.*)\);$', line.strip())
                    if m:
                        tokens = parse_sql_values(m.group(1))
                        # `ID`, `user_login`, `user_pass`, `user_nicename`, `user_email`, `user_url`, `user_registered`, `user_activation_key`, `user_status`, `display_name`
                        if len(tokens) >= 10:
                            uid = tokens[0]
                            display_name = tokens[9] or tokens[1]
                            user_names[uid] = display_name
        print(f"[Parser] Loaded {len(user_names)} users.")

    # 2. Parse Terms
    terms = {}
    terms_file = os.path.join(SQL_DIR, 'wp_133379588_terms.sql')
    if os.path.exists(terms_file):
        with open(terms_file, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if line.startswith('INSERT INTO `wp_133379588_terms`'):
                    m = re.search(r'VALUES \((.*)\);$', line.strip())
                    if m:
                        tokens = parse_sql_values(m.group(1))
                        # `term_id`, `name`, `slug`, `term_group`
                        if len(tokens) >= 3:
                            terms[tokens[0]] = {'name': tokens[1], 'slug': tokens[2]}
        print(f"[Parser] Loaded {len(terms)} terms.")

    # 3. Parse Term Taxonomy
    # Maps term_taxonomy_id -> { term_id, taxonomy, name, slug }
    taxonomies = {}
    tax_file = os.path.join(SQL_DIR, 'wp_133379588_term_taxonomy.sql')
    if os.path.exists(tax_file):
        with open(tax_file, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if line.startswith('INSERT INTO `wp_133379588_term_taxonomy`'):
                    m = re.search(r'VALUES \((.*)\);$', line.strip())
                    if m:
                        tokens = parse_sql_values(m.group(1))
                        # `term_taxonomy_id`, `term_id`, `taxonomy`, `description`, `parent`, `count`
                        if len(tokens) >= 3:
                            tt_id = tokens[0]
                            t_id = tokens[1]
                            taxonomy = tokens[2]
                            t_info = terms.get(t_id, {'name': '', 'slug': ''})
                            taxonomies[tt_id] = {
                                'term_id': t_id,
                                'taxonomy': taxonomy,
                                'name': t_info['name'],
                                'slug': t_info['slug']
                            }
        print(f"[Parser] Loaded {len(taxonomies)} term taxonomies.")

    # 4. Parse Term Relationships
    # Maps object_id (post_id) -> list of taxonomies
    post_terms = {}
    rel_file = os.path.join(SQL_DIR, 'wp_133379588_term_relationships.sql')
    if os.path.exists(rel_file):
        with open(rel_file, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if line.startswith('INSERT INTO `wp_133379588_term_relationships`'):
                    m = re.search(r'VALUES \((.*)\);$', line.strip())
                    if m:
                        tokens = parse_sql_values(m.group(1))
                        # `object_id`, `term_taxonomy_id`, `term_order`
                        if len(tokens) >= 2:
                            post_id = tokens[0]
                            tt_id = tokens[1]
                            if post_id not in post_terms:
                                post_terms[post_id] = []
                            if tt_id in taxonomies:
                                post_terms[post_id].append(taxonomies[tt_id])
        print(f"[Parser] Loaded term relationships for {len(post_terms)} objects.")

    # 5. Parse Postmeta for Featured Thumbnails (_thumbnail_id)
    post_thumbnails = {}
    meta_file = os.path.join(SQL_DIR, 'wp_133379588_postmeta.sql')
    if os.path.exists(meta_file):
        with open(meta_file, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if "'_thumbnail_id'" in line and line.startswith('INSERT INTO `wp_133379588_postmeta`'):
                    m = re.search(r'VALUES \((.*)\);$', line.strip())
                    if m:
                        tokens = parse_sql_values(m.group(1))
                        # `meta_id`, `post_id`, `meta_key`, `meta_value`
                        if len(tokens) >= 4 and tokens[2] == '_thumbnail_id':
                            try:
                                post_thumbnails[tokens[1]] = int(tokens[3])
                            except (ValueError, TypeError):
                                pass
        print(f"[Parser] Loaded {len(post_thumbnails)} featured thumbnail mappings.")

    # 6. Parse Posts in Two Passes:
    # Pass A: Collect attachments (post_type == 'attachment')
    # Pass B: Collect yada_wiki, post, page
    attachments = {}
    articles = []

    posts_file = os.path.join(SQL_DIR, 'wp_133379588_posts.sql')
    print(f"[Parser] Scanning {posts_file}...")

    # Pass A: Attachments
    with open(posts_file, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if "'attachment'" in line and line.startswith('INSERT INTO `wp_133379588_posts`'):
                m = re.search(r'VALUES \((.*)\);$', line.strip())
                if m:
                    tokens = parse_sql_values(m.group(1))
                    if len(tokens) >= 21 and tokens[20] == 'attachment':
                        pid = tokens[0]
                        guid = tokens[18]
                        mime_type = tokens[21]
                        attachments[pid] = {
                            'id': pid,
                            'url': guid,
                            'mime_type': mime_type
                        }
    print(f"[Parser] Indexed {len(attachments)} attachments.")

    # Pass B: Articles
    stats = {'yada_wiki': 0, 'post': 0, 'page': 0}
    with open(posts_file, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if line.startswith('INSERT INTO `wp_133379588_posts`'):
                # Quick check if it's one of our target post types
                if not ("'yada_wiki'" in line or "'post'" in line or "'page'" in line):
                    continue

                m = re.search(r'VALUES \((.*)\);$', line.strip())
                if not m:
                    continue

                tokens = parse_sql_values(m.group(1))
                if len(tokens) < 21:
                    continue

                post_type = tokens[20]
                if post_type not in ('yada_wiki', 'post', 'page'):
                    continue

                pid = tokens[0]
                author_id = tokens[1]
                post_date = tokens[2]
                post_content = tokens[4] or ''
                post_title = tokens[5] or ''
                post_excerpt = tokens[6] or ''
                post_status = tokens[7]
                post_name = tokens[11] or f"{post_type}-{pid}"
                guid = tokens[18]

                # Skip auto-drafts and revisions
                if post_status in ('auto-draft', 'inherit'):
                    continue

                stats[post_type] = stats.get(post_type, 0) + 1

                # Resolve terms
                terms_list = post_terms.get(pid, [])
                categories = []
                tags = []
                for t in terms_list:
                    tax = t['taxonomy']
                    name = t['name']
                    if not name or name.lower() == 'uncategorized':
                        continue
                    if tax in ('category', 'wiki_cats'):
                        categories.append(name)
                    elif tax in ('post_tag', 'wiki_tags'):
                        tags.append(name)

                # Author
                author_name = user_names.get(author_id, 'Sam FS Chin')
                if not author_name or author_name == 'admin' or author_name == 'ZhongXinDao':
                    author_name = 'Sam FS Chin'

                # Featured Thumbnail
                thumbnail_url = ''
                if pid in post_thumbnails:
                    thumb_att_id = post_thumbnails[pid]
                    if thumb_att_id in attachments:
                        thumbnail_url = attachments[thumb_att_id]['url']

                # Extract referenced media URLs in content
                img_matches = re.findall(r'https?://[^\s"\'><)]+\.(?:jpg|jpeg|png|gif|webp|pdf|mp4)', post_content, re.IGNORECASE)
                unique_images = list(set([img.split('?')[0] for img in img_matches]))

                # Check video embeds
                has_video = ('youtube.com' in post_content or 'youtu.be' in post_content or 
                             'vimeo.com' in post_content or '[youtube' in post_content or '[vimeo' in post_content)

                # Plain text word count
                clean_text = re.sub(r'<[^>]*>', ' ', post_content)
                clean_text = re.sub(r'\[[^\]]*\]', ' ', clean_text)
                clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                word_count = len(clean_text.split())

                articles.append({
                    'id': pid,
                    'post_type': post_type,
                    'title': post_title,
                    'slug': post_name,
                    'status': post_status,
                    'post_date': str(post_date),
                    'author_id': author_id,
                    'author_name': author_name,
                    'categories': categories,
                    'tags': tags,
                    'thumbnail_url': thumbnail_url,
                    'media_urls': unique_images,
                    'has_video': has_video,
                    'char_count': len(clean_text),
                    'word_count': word_count,
                    'excerpt': post_excerpt,
                    'content_html': post_content,
                    'guid': guid,
                })

    print(f"\n[Parser] Extraction complete:")
    print(f"  • yada_wiki posts: {stats.get('yada_wiki', 0)}")
    print(f"  • standard posts:  {stats.get('post', 0)}")
    print(f"  • standard pages:  {stats.get('page', 0)}")
    print(f"  • Total extracted: {len(articles)}")

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(articles, f, indent=2, ensure_ascii=False)

    print(f"\n[Parser] Successfully saved {len(articles)} articles to {OUTPUT_JSON}")

if __name__ == '__main__':
    main()
