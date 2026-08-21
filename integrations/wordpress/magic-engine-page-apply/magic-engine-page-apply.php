<?php
/**
 * Plugin Name: Magic Engine Page Apply
 * Description: Atomic compare-and-set updates for approved Yoast page metadata.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const MAGIC_ENGINE_PAGE_APPLY_NAMESPACE = 'magic-engine/v1';
const MAGIC_ENGINE_PAGE_APPLY_VERSION = 1;
const MAGIC_ENGINE_ALLOWED_META_KEYS = array(
    '_yoast_wpseo_title',
    '_yoast_wpseo_metadesc',
);

function magic_engine_page_apply_tables_are_transactional() {
    global $wpdb;
    $table_names = array($wpdb->posts, $wpdb->postmeta);
    foreach ($table_names as $table_name) {
        $row = $wpdb->get_row($wpdb->prepare('SHOW TABLE STATUS WHERE Name = %s', $table_name));
        if (!$row || strtoupper((string) $row->Engine) !== 'INNODB') {
            return false;
        }
    }
    return true;
}

function magic_engine_page_apply_permission() {
    return current_user_can('edit_posts');
}

function magic_engine_page_apply_capabilities() {
    return rest_ensure_response(array(
        'atomic_compare_and_set' => magic_engine_page_apply_tables_are_transactional(),
        'version' => MAGIC_ENGINE_PAGE_APPLY_VERSION,
    ));
}

function magic_engine_page_apply_error($code, $message, $status) {
    return new WP_Error($code, $message, array('status' => $status));
}

function magic_engine_page_apply_update(WP_REST_Request $request) {
    global $wpdb;

    if (!magic_engine_page_apply_tables_are_transactional()) {
        return magic_engine_page_apply_error('atomic_apply_unavailable', 'Transactional tables are required.', 503);
    }

    $post_id = (int) $request['id'];
    $post_type = (string) $request['post_type'];
    if (!current_user_can('edit_post', $post_id)) {
        return magic_engine_page_apply_error('forbidden', 'The authenticated user cannot edit this post.', 403);
    }

    $body = $request->get_json_params();
    $expected = isset($body['expected_modified']) ? (string) $body['expected_modified'] : '';
    $expected_meta = isset($body['expected_meta']) && is_array($body['expected_meta']) ? $body['expected_meta'] : null;
    $update = isset($body['update']) && is_array($body['update']) ? $body['update'] : null;
    if ($expected === '' || $expected_meta === null || $update === null || array_keys($update) !== array('meta')) {
        return magic_engine_page_apply_error('invalid_request', 'Only one non-empty meta update is accepted.', 400);
    }
    $meta = isset($update['meta']) && is_array($update['meta']) ? $update['meta'] : null;
    if (
        !$meta || array_diff(array_keys($meta), MAGIC_ENGINE_ALLOWED_META_KEYS) ||
        array_keys($expected_meta) !== array_keys($meta)
    ) {
        return magic_engine_page_apply_error('invalid_meta', 'Only approved Yoast title/description keys are accepted.', 400);
    }
    foreach ($meta as $key => $value) {
        if (!is_string($value) || !is_string($expected_meta[$key])) {
            return magic_engine_page_apply_error('invalid_meta_value', 'Yoast metadata values must be strings.', 400);
        }
    }

    if ($wpdb->query('START TRANSACTION') === false) {
        return magic_engine_page_apply_error('atomic_apply_failed', 'Unable to start an atomic page update.', 500);
    }
    try {
        $post = $wpdb->get_row($wpdb->prepare(
            "SELECT ID, post_type, post_status, post_modified FROM {$wpdb->posts} WHERE ID = %d FOR UPDATE",
            $post_id
        ));
        if (!$post || $post->post_type !== $post_type || $post->post_status !== 'publish') {
            $wpdb->query('ROLLBACK');
            return magic_engine_page_apply_error('target_mismatch', 'The exact published target no longer matches.', 409);
        }

        $previous_modified = mysql_to_rfc3339($post->post_modified);
        if (!hash_equals($previous_modified, $expected)) {
            $wpdb->query('ROLLBACK');
            return magic_engine_page_apply_error('version_conflict', 'The target modified token has changed.', 409);
        }

        $meta_keys = array_keys($meta);
        $placeholders = implode(', ', array_fill(0, count($meta_keys), '%s'));
        $locked_meta_rows = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_id, meta_key, meta_value FROM {$wpdb->postmeta} " .
            "WHERE post_id = %d AND meta_key IN ({$placeholders}) FOR UPDATE",
            array_merge(array($post_id), $meta_keys)
        ));
        $live_meta = array_fill_keys($meta_keys, '');
        foreach ($locked_meta_rows as $meta_row) {
            $live_meta[$meta_row->meta_key] = (string) maybe_unserialize($meta_row->meta_value);
        }
        foreach ($expected_meta as $key => $value) {
            if (!hash_equals($live_meta[$key], $value)) {
                $wpdb->query('ROLLBACK');
                return magic_engine_page_apply_error('meta_conflict', 'Approved metadata changed before apply.', 409);
            }
        }

        foreach ($meta as $key => $value) {
            if (update_post_meta($post_id, $key, wp_slash($value)) === false &&
                get_post_meta($post_id, $key, true) !== $value) {
                throw new RuntimeException('Unable to update approved metadata.');
            }
        }

        $next_modified = current_time('mysql');
        if ($next_modified <= $post->post_modified) {
            $next_modified = gmdate('Y-m-d H:i:s', strtotime($post->post_modified . ' +1 second'));
        }
        $updated = $wpdb->update(
            $wpdb->posts,
            array(
                'post_modified' => $next_modified,
                'post_modified_gmt' => get_gmt_from_date($next_modified),
            ),
            array('ID' => $post_id),
            array('%s', '%s'),
            array('%d')
        );
        if ($updated !== 1) {
            throw new RuntimeException('Unable to advance the post modified token.');
        }

        if ($wpdb->query('COMMIT') === false) {
            throw new RuntimeException('Unable to commit the atomic page update.');
        }
        clean_post_cache($post_id);
        wp_cache_delete($post_id, 'post_meta');

        return rest_ensure_response(array(
            'applied' => true,
            'previous_modified' => $previous_modified,
            'post_id' => $post_id,
            'post_type' => $post_type,
            'link' => get_permalink($post_id),
            'modified' => mysql_to_rfc3339($next_modified),
        ));
    } catch (Throwable $error) {
        $wpdb->query('ROLLBACK');
        clean_post_cache($post_id);
        wp_cache_delete($post_id, 'post_meta');
        return magic_engine_page_apply_error('atomic_apply_failed', 'The atomic page update failed.', 500);
    }
}

add_action('rest_api_init', function () {
    register_rest_route(MAGIC_ENGINE_PAGE_APPLY_NAMESPACE, '/page-apply/capabilities', array(
        'methods' => WP_REST_Server::READABLE,
        'permission_callback' => 'magic_engine_page_apply_permission',
        'callback' => 'magic_engine_page_apply_capabilities',
    ));
    register_rest_route(
        MAGIC_ENGINE_PAGE_APPLY_NAMESPACE,
        '/page-apply/(?P<post_type>post|page)/(?P<id>[1-9][0-9]*)',
        array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'magic_engine_page_apply_permission',
            'callback' => 'magic_engine_page_apply_update',
        )
    );
});
