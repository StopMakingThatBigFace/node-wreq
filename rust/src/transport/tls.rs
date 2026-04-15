use crate::transport::types::{CertificateAuthorityOptions, TlsIdentityOptions};
use anyhow::{Context, Result};
use wreq::{
    ClientBuilder,
    tls::{CertStore, Identity},
};

pub fn configure_client_builder(
    mut builder: ClientBuilder,
    tls_identity: Option<TlsIdentityOptions>,
    certificate_authority: Option<CertificateAuthorityOptions>,
) -> Result<ClientBuilder> {
    if let Some(tls_identity) = tls_identity {
        builder = builder.identity(build_identity(tls_identity)?);
    }

    if let Some(certificate_authority) = certificate_authority {
        builder = builder.cert_store(build_cert_store(certificate_authority)?);
    }

    Ok(builder)
}

fn build_identity(options: TlsIdentityOptions) -> Result<Identity> {
    match options {
        TlsIdentityOptions::Pem { cert, key } => {
            Identity::from_pkcs8_pem(&cert, &key).context("Failed to parse TLS identity from PEM")
        }
        TlsIdentityOptions::Pfx {
            archive,
            passphrase,
        } => Identity::from_pkcs12_der(&archive, passphrase.as_deref().unwrap_or(""))
            .context("Failed to parse TLS identity from PKCS#12"),
    }
}

fn build_cert_store(options: CertificateAuthorityOptions) -> Result<CertStore> {
    let mut builder = CertStore::builder();

    if options.include_default_roots {
        builder = builder.add_der_certs(webpki_root_certs::TLS_SERVER_ROOT_CERTS);
    }

    for cert in &options.certs {
        builder = builder.add_stack_pem_certs(cert);
    }

    builder
        .build()
        .context("Failed to build TLS certificate store")
}
